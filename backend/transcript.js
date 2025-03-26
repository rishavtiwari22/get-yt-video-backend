import axios from "axios";
export async function getYouTubeTranscript(videoId) {
    try {
        console.log("Fetching transcript for video ID:", videoId);
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
        const html = response.data;
        const captionsMatch = html.split('"captions":')[1]?.split(',"videoDetails')[0];
        if (!captionsMatch) throw new Error("Transcripts not available");
        const captionsData = JSON.parse(captionsMatch);
        const transcriptUrl = captionsData.playerCaptionsTracklistRenderer?.captionTracks?.[0]?.baseUrl;
        if (!transcriptUrl) throw new Error("No captions found");
        const transcriptResponse = await axios.get(transcriptUrl);
        const transcriptXml = transcriptResponse.data;
        const transcript = [...transcriptXml.matchAll(/<text[^>]+>(.*?)<\/text>/g)]
            .map(match => match[1].replace(/;#39;/g, "'").replace(/&quot;/g, '"').replace(/&/g, ""))
            .join(" ");
        console.log('Transcript in the backend : ', transcript);
        return transcript;
    } catch (error) {
        console.error("Error fetching transcript:", error.message);
        return { error: error.message };
    }
}