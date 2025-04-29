import express from "express";
import cors from "cors";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
// import { getYouTubeTranscript } from "./transcript.js";
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
    minItems: 10,   // Reduced from 10 to 5
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
        const finalQuestions = validQuestions.map(({ question, options, correctAnswer }) => ({
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

// Serverless function handler for Vercel
app.post('/api/get-transcript', async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
        console.log("Error: No video ID provided");
        return res.status(400).json({ error: "Video ID is required" });
    }

    try {
        console.log(`Processing request for video ID: ${videoId}`);
        const transcriptResult = await getYouTubeTranscript(videoId);

        // Check if transcript result contains an error
        if (typeof transcriptResult === 'object' && transcriptResult.error) {
            console.log("Transcript error:", transcriptResult.error);
            return res.status(400).json({ error: transcriptResult.error });
        }

        // At this point we know we have a valid transcript string
        const transcript = transcriptResult;
        console.log(`Transcript fetched successfully (${transcript.length} characters). Generating questions...`);

        const result = await generateQuestions(transcript);
        console.log(`Generated ${result.length} questions successfully`);

        res.json({ result });
    } catch (error) {
        console.error("Error in route handler:", error);

        if (error.message && error.message.includes("Not enough reliable information")) {
            return res.status(400).json({ error: error.message });
        }

        res.status(500).json({ error: "Failed to generate questions. Please try another video." });
    }
});

async function getYouTubeTranscript(videoId) {
    try {
        console.log("Fetching transcript for video ID:", videoId);
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
        const html = response.data;

        // Try multiple methods to extract captions
        let captionsMatch = html.split('"captions":')[1]?.split(',"videoDetails')[0];

        if (!captionsMatch) {
            // Try alternate pattern
            captionsMatch = html.split('"captionTracks":')[1]?.split(',"audioTracks')[0];

            if (!captionsMatch) {
                console.error("Transcripts not available for this video");
                return { error: "Transcripts not available" };
            }
        }

        // Parse caption data using a more robust method
        let captionTracks = [];
        try {
            const captionsData = JSON.parse(captionsMatch);
            captionTracks = captionsData.playerCaptionsTracklistRenderer?.captionTracks ||
                JSON.parse(`[${captionsMatch}]`);  // Fallback parsing method
        } catch (e) {
            // Try regex extraction as a last resort
            const baseUrlRegex = /"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g;
            const matches = [...html.matchAll(baseUrlRegex)];

            if (matches && matches.length > 0) {
                captionTracks = matches.map(match => ({ baseUrl: match[1].replace(/\\u0026/g, '&') }));
            } else {
                console.error("Failed to parse captions data");
                return { error: "Transcripts not available" };
            }
        }

        if (!captionTracks || captionTracks.length === 0) {
            console.error("No captions found in this video");
            return { error: "Transcripts not available" };
        }

        // Get English transcript if available, otherwise use the first available one
        const englishTrack = captionTracks.find(track =>
            track.languageCode === 'en' ||
            track.name?.simpleText?.toLowerCase().includes('english') ||
            track.baseUrl?.includes('lang=en'));

        const transcriptUrl = englishTrack?.baseUrl || captionTracks[0].baseUrl;

        if (!transcriptUrl) {
            console.error("No captions found in this video");
            return { error: "Transcripts not available" };
        }

        const transcriptResponse = await axios.get(transcriptUrl);
        const transcriptXml = transcriptResponse.data;

        // More robust transcript extraction with better cleaning
        const transcriptSegments = [...transcriptXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
            .map(match => {
                // Decode HTML entities and clean text
                let text = match[1]
                    .replace(/&amp;#39;/g, "'")
                    .replace(/&amp;quot;/g, '"')
                    .replace(/&amp;/g, "&")
                    .replace(/&#39;/g, "'")
                    .replace(/&quot;/g, '"')
                    .replace(/&lt;/g, "<")
                    .replace(/&gt;/g, ">")
                    .replace(/\n/g, " ")
                    .trim();

                // Replace HTML entities that might remain
                text = text.replace(/&[^;]+;/g, " ");

                return text;
            })
            .filter(text => text.length > 0);  // Remove empty segments

        let transcript = transcriptSegments.join(" ");

        // Add period after sentences if they're missing to improve text structure
        transcript = transcript.replace(/([a-z])\s+([A-Z])/g, "$1. $2");

        // Verify transcript has sufficient content for generating questions
        if (transcript.split(' ').length < 50) {  // Reduced minimum word count
            console.error("Transcript too short to generate meaningful questions");
            return { error: "Not enough reliable information in the transcript" };
        }

        console.log('Transcript in the backend (first 200 chars): ', transcript.substring(0, 200) + '...');
        return transcript;
    } catch (error) {
        console.error("Error fetching transcript:", error.message);
        return { error: "Transcripts not available" };
    }
}

const PORT = "3000";
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});



export default app;


