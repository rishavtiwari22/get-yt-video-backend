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
        
        // Try fetching captions directly from timedtext API first
        const directUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`;
        try {
            const directResponse = await axios.get(directUrl);
            if (directResponse.data && directResponse.data.includes('<text')) {
                return processTranscript(directResponse.data);
            }
        } catch (directError) {
            console.log("Direct transcript fetch failed, trying alternative method...");
        }

        // Fallback to page HTML method
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const html = response.data;
        
        // Extract captions data
        const patterns = [
            /"captions":({[^}]+})/,
            /"captionTracks":\[(.*?)\]/,
            /\{"playerCaptionsTracklistRenderer":\{.*?\}\}/
        ];

        let captionsMatch = null;
        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                captionsMatch = match[1];
                break;
            }
        }

        if (!captionsMatch) {
            console.error("No caption data found in response");
            return { error: "Transcripts not available" };
        }

        // Parse caption tracks
        let captionTracks = [];
        try {
            const captionsData = JSON.parse(captionsMatch);
            if (captionsData.playerCaptionsTracklistRenderer) {
                captionTracks = captionsData.playerCaptionsTracklistRenderer.captionTracks;
            } else if (Array.isArray(captionsData)) {
                captionTracks = captionsData;
            }
        } catch (e) {
            // Try regex extraction as last resort
            const baseUrlRegex = /"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g;
            const matches = [...captionsMatch.matchAll(baseUrlRegex)];
            captionTracks = matches.map(match => ({ baseUrl: match[1].replace(/\\u0026/g, '&') }));
        }

        if (!captionTracks || captionTracks.length === 0) {
            console.error("No caption tracks found");
            return { error: "Transcripts not available" };
        }

        // Get English transcript or first available
        const englishTrack = captionTracks.find(track => 
            track.languageCode === 'en' || 
            track.name?.simpleText?.toLowerCase().includes('english') ||
            track.baseUrl?.includes('lang=en')
        ) || captionTracks[0];

        if (!englishTrack || !englishTrack.baseUrl) {
            console.error("No valid transcript URL found");
            return { error: "Transcripts not available" };
        }

        const transcriptResponse = await axios.get(englishTrack.baseUrl);
        return processTranscript(transcriptResponse.data);

    } catch (error) {
        console.error("Error fetching transcript:", error.message);
        return { error: "Failed to fetch transcript" };
    }
}

function processTranscript(transcriptXml) {
    try {
        // Extract and clean transcript segments
        const transcriptSegments = [...transcriptXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)]
            .map(match => {
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
                
                text = text.replace(/&[^;]+;/g, " ");
                return text;
            })
            .filter(text => text.length > 0);

        if (transcriptSegments.length === 0) {
            console.error("No text segments found in transcript");
            return { error: "No valid transcript content found" };
        }

        let transcript = transcriptSegments.join(" ");
        transcript = transcript.replace(/([a-z])\s+([A-Z])/g, "$1. $2");
        
        // Validate transcript content
        if (transcript.split(' ').length < 50) {
            console.error("Transcript too short");
            return { error: "Not enough content in transcript" };
        }

        console.log('Transcript retrieved successfully:', transcript.substring(0, 200) + '...');
        return transcript;
    } catch (error) {
        console.error("Error processing transcript:", error.message);
        return { error: "Failed to process transcript" };
    }
}

const PORT = "3000";
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});



export default app;


