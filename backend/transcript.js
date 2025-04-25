import axios from "axios";

export async function getYouTubeTranscript(videoId) {
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
