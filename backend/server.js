import express from "express";
import cors from "cors";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getYouTubeTranscript } from "./transcript.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.post("/get-transcript", async (req, res) => {
    const { videoId } = req.body;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required" });
    }
    try {
        const transcript = await getYouTubeTranscript(videoId);
        if ("Transcripts not available" === transcript) {
            return res.status(404).json({ error: "Transcripts not available" });
        }
        const result = await generateQuestions(transcript);
        res.json({ result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API);

const schema = {
    description: "A list a 10 of multiple-choice questions generated from the given text.",
    type: "array",
    minItems: 10,
    maxItems: 10,
    items: {
        type: "object",
        description: "A multiple-choice question with four options and one correct answer.",
        properties: {
            question: {
                type: "string",
                description: "The question text."
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
            }
        },
        required: ["question", "options", "correctAnswer"],
    }
};


async function generateQuestions(transcript) {
    try {
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
            },
        });

        const result = await model.generateContent(`Generate 10 multiple-choice questions from this text: ${transcript}`);
        
        if (!result.response || !result.response.text) {
            throw new Error("Invalid response from AI model.");
        }
        const questions = JSON.parse(result.response.text());
        return questions;
        
    } catch (error) {
        console.error("Error generating questions:", error);
        return null;
    }
}


app.listen(3001, () => console.log("Server running on http://localhost:3001"));

app.get("/", (req, res) => {
    res.send("Hello World!");
});