import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getYouTubeTranscript } from "./transcript.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);

// Modified schema with fewer minimum questions
const schema = {
    description: "A list of multiple-choice questions generated from the given text.",
    type: "array",
    minItems: 5,   // Reduced from 10 to 5
    maxItems: 10,
    items: {
        type: "object",
        description: "A multiple-choice question with four options and one correct answer.",
        properties: {
            question: {
                type: "string",
                description: "The question text. Should be clear and based on the transcript content."
            },
            options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" },
                description: "Four answer choices, including one correct answer."
            },
            correctAnswer: {
                type: "string",
                description: "The correct answer, which must be one of the options."
            },
            confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "Confidence score (0-1)."
            }
        },
        required: ["question", "options", "correctAnswer", "confidence"],
    }
};

async function generateQuestions(transcript) {
    try {
        // Clean transcript further to improve processing
        const cleanedTranscript = transcript
            .replace(/(\w+)\s\1\s\1/g, '$1 $1') // Remove triple repeated words
            .replace(/(\w+)\s\1/g, '$1')        // Remove double repeated words
            .replace(/\s{2,}/g, ' ')           // Remove multiple spaces
            .trim();
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.2,  // Slightly increased for more variety
                maxOutputTokens: 8000,
            },
        });

        const prompt = `
        Generate multiple-choice educational quiz questions based on this YouTube video transcript:

        GUIDANCE FOR GENERATING GOOD QUESTIONS:
        1. Create questions about key concepts, facts, definitions, or ideas from the transcript.
        2. Make questions clear and specific - each should stand on its own without needing additional context.
        3. For each question, provide exactly 4 options with only one correct answer.
        4. Focus on the main educational content in the transcript.
        5. Assign higher confidence scores (0.7+) to questions about clearly stated information.
        6. If the content is technical or specialized, include necessary context within the question.
        7. Avoid creating questions about ambiguous or unclear parts of the transcript.

        Transcript: ${cleanedTranscript}
        
        Remember to create educational questions that test understanding of the content.`;

        const result = await model.generateContent(prompt);
        
        if (!result.response || !result.response.text) {
            throw new Error("Invalid response from AI model.");
        }
        
        // Parse and validate questions
        let questions;
        try {
            questions = JSON.parse(result.response.text());
        } catch (e) {
            console.error("Failed to parse JSON response:", e);
            throw new Error("AI returned invalid JSON. Please try another video.");
        }
        
        // Filter to questions with reasonable confidence levels - more lenient now
        const acceptableQuestions = questions.filter(q => q.confidence >= 0.6);
        
        // Apply basic validation
        const validQuestions = acceptableQuestions.filter(q => {
            // Question must have reasonable length
            if (q.question.length < 20) return false;
            
            // Options should be all present and distinct
            const uniqueOptions = new Set(q.options);
            if (uniqueOptions.size !== 4) return false;
            
            // Correct answer must be in options
            if (!q.options.includes(q.correctAnswer)) return false;
            
            return true;
        });
        
        // Remove fields not needed in frontend
        const finalQuestions = validQuestions.map(({question, options, correctAnswer}) => ({
            question, options, correctAnswer
        }));
        
        // More lenient minimum question threshold
        if (finalQuestions.length < 3) {
            throw new Error("Not enough reliable information in the transcript to generate a quiz");
        }
        
        return finalQuestions;
        
    } catch (error) {
        console.error("Error generating questions:", error);
        throw error;
    }
}

app.post("/get-transcript", async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required" });
    }
    try {
        const transcript = await getYouTubeTranscript(videoId);
        
        // Check if transcript is an error object
        if (transcript && transcript.error) {
            return res.status(404).json({ error: transcript.error });
        }
        
        const result = await generateQuestions(transcript);
        res.json({ result });
    } catch (error) {
        console.error("Error in route handler:", error);
        if (error.message.includes("Not enough reliable information")) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to generate questions. Please try another video." });
    }
});

app.listen(3001, () => console.log("Server running on http://localhost:3001"));

app.get("/", (req, res) => {
    res.send("Hello World!");
});