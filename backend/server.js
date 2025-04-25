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

const schema = {
    description: "A list of multiple-choice questions generated from the given text. Each question must be complete, clear, and based only on information that is explicitly provided in the transcript.",
    type: "array",
    minItems: 10,
    maxItems: 10,
    items: {
        type: "object",
        description: "A multiple-choice question with four options and one correct answer.",
        properties: {
            question: {
                type: "string",
                description: "The question text. Must be clear, complete, and self-contained - include all necessary context and information needed to answer the question without referencing external information."
            },
            context: {
                type: "string",
                description: "The specific part of the transcript that provides the information for this question. Used for validation."
            },
            options: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "string" },
                description: "Four answer choices, including one correct answer. All options should be plausible."
            },
            correctAnswer: {
                type: "string",
                description: "The correct answer, which must be one of the options and verifiable from the transcript."
            },
            confidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "Confidence score (0-1) indicating how certain you are that this question is factually correct based on the transcript."
            }
        },
        required: ["question", "options", "correctAnswer", "confidence", "context"],
    }
};

async function generateQuestions(transcript) {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                temperature: 0.1, // Even lower temperature for more factual responses
                maxOutputTokens: 8000, // Increased token limit for more detailed responses
            },
        });

        const prompt = `
        Generate multiple-choice questions based SOLELY on the information explicitly provided in this transcript.
        
        IMPORTANT RULES:
        1. Create questions ONLY about information CLEARLY stated in the transcript.
        2. ALWAYS include the complete context in the question. For example, if referring to an equation or expression, include it directly in the question text.
        3. DO NOT create questions that reference "the given expression" or "the mentioned problem" without explicitly stating what that expression or problem is.
        4. For each question, include the exact part of the transcript that contains the information for that question in the "context" field.
        5. Each question must be self-contained with all necessary information to answer it.
        6. For mathematical questions, include the full equation or expression in the question text.
        7. Assign a confidence score (0-1) to each question based on how clearly the answer is supported by the transcript.
        8. If you cannot create at least 5 high-quality, complete questions (confidence > 0.8), return fewer questions rather than creating ambiguous ones.
        
        EXAMPLES OF BAD QUESTIONS (DO NOT GENERATE THESE):
        - "What are the two possible values of y that satisfy the given expression?" (INCOMPLETE: expression not specified)
        - "Which option is the correct solution to the problem?" (INCOMPLETE: problem not specified)
        
        EXAMPLES OF GOOD QUESTIONS:
        - "What are the two possible values of y that satisfy the expression 2y² - 5y - 3 = 0?"
        - "Which option is the correct solution to the equation 3x + 4 = 10?"
        
        Transcript: ${transcript}`;

        const result = await model.generateContent(prompt);
        
        if (!result.response || !result.response.text) {
            throw new Error("Invalid response from AI model.");
        }
        
        // Parse and validate questions
        const allQuestions = JSON.parse(result.response.text());
        
        // Filter out questions with low confidence scores
        const highQualityQuestions = allQuestions.filter(q => q.confidence >= 0.8);
        
        // Validate each question for completeness and clarity
        const validatedQuestions = highQualityQuestions.filter(q => validateQuestionCompleteness(q));
        
        // Remove fields not needed in frontend
        const finalQuestions = validatedQuestions.map(({question, options, correctAnswer}) => ({
            question, options, correctAnswer
        }));
        
        if (finalQuestions.length < 5) {
            throw new Error("Not enough reliable information in the transcript to generate a quiz");
        }
        
        return finalQuestions;
        
    } catch (error) {
        console.error("Error generating questions:", error);
        throw error; // Re-throw to be handled by route handler
    }
}

// Function to validate if a question is complete
function validateQuestionCompleteness(question) {
    // Check for suspicious phrases that suggest incomplete context
    const suspiciousPatterns = [
        /the (given|above|following|mentioned) (expression|equation|formula|problem)/i,
        /this (expression|equation|formula|problem)/i,
        /solve (for|the following)/i,
        /find the value/i
    ];
    
    // If the question contains suspicious phrases, check if it also contains mathematical notation
    // that would provide the needed context
    const containsSuspiciousPhrase = suspiciousPatterns.some(pattern => 
        pattern.test(question.question)
    );
    
    // If suspicious phrase detected, verify the question actually includes the mathematical content
    if (containsSuspiciousPhrase) {
        const hasMathContent = /[=<>+\-*\/^²³⁴]+/.test(question.question);
        if (!hasMathContent) return false;
    }
    
    // Check for minimum question length (complete questions are rarely very short)
    if (question.question.length < 30) return false;
    
    // Verify question doesn't end with prepositions or certain words that suggest missing content
    if (/(?:in|of|for|with|by|the|a|to|as)\.?$/i.test(question.question.trim())) return false;
    
    return true;
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
            // Pass through the specific error
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