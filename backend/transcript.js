import axios from "axios";
export async function getYouTubeTranscript(videoId) {
    try {
        console.log("Fetching transcript for video ID:", videoId);
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
        const html = response.data;
        const captionsMatch = html.split('"captions":')[1]?.split(',"videoDetails')[0];
        
        if (!captionsMatch) {
            console.error("Transcripts not available for this video");
            return { error: "Transcripts not available" };
        }
        
        const captionsData = JSON.parse(captionsMatch);
        const captionTracks = captionsData.playerCaptionsTracklistRenderer?.captionTracks;
        
        if (!captionTracks || captionTracks.length === 0) {
            console.error("No captions found in this video");
            return { error: "Transcripts not available" };
        }
        
        // Get English transcript if available, otherwise use the first available one
        const englishTrack = captionTracks.find(track => 
            track.languageCode === 'en' || 
            track.name?.simpleText?.toLowerCase().includes('english'));
            
        const transcriptUrl = englishTrack?.baseUrl || captionTracks[0].baseUrl;
        
        if (!transcriptUrl) {
            console.error("No captions found in this video");
            return { error: "Transcripts not available" };
        }
        
        const transcriptResponse = await axios.get(transcriptUrl);
        const transcriptXml = transcriptResponse.data;
        const transcript = [...transcriptXml.matchAll(/<text[^>]+>(.*?)<\/text>/g)]
            .map(match => match[1]
                .replace(/&amp;#39;/g, "'")
                .replace(/&amp;quot;/g, '"')
                .replace(/&amp;/g, "&")
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&/g, "and"))
            .join(" ");
        
        // Verify transcript has sufficient content for generating questions
        if (transcript.split(' ').length < 100) {
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