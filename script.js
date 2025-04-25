// Initialize quiz variables
let quizData = [];
let currentQuestion = 0;
let score = 0;
let incorrectAnswers = [];

document.addEventListener("DOMContentLoaded", () => {
    document.querySelector('.quiz-container').classList.add('animate-in');
    document.querySelector('.link').classList.add('animate-in');

    const btn = document.getElementById("btn");
    const quizContainer = document.getElementById("quiz");
    const resultContainer = document.getElementById("result");
    const submitButton = document.getElementById("submit");
    const retryButton = document.getElementById("retry");
    const showAnswerButton = document.getElementById("showAnswer");
    const youtubeUrlInput = document.getElementById("youtube-url");

    // Button event handler with loading state
    btn.addEventListener("click", async () => {
        const youtubeUrl = youtubeUrlInput.value.trim();
        if (!youtubeUrl) {
            showToast("Please enter a YouTube URL", "error");
            return;
        }

        if (!isValidYouTubeUrl(youtubeUrl)) {
            showToast("Invalid YouTube URL format", "error");
            return;
        }

        // Set loading state
        btn.textContent = 'Loading...';
        btn.disabled = true;
        
        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            showToast("Could not extract video ID", "error");
            resetButtonState();
            return;
        }

        try {
            showToast("Generating questions...", "info");
            
            console.log(`Sending request for video ID: ${videoId}`);
            const baseUrl = process.env.BASE_URL;
            // Use relative path for API endpoint for production compatibility
            const apiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                ? "http://localhost:3000/api/get-transcript" 
                : `${baseUrl}/api/get-transcript`;
                
            const response = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId }),
            });

            // Check for non-OK responses
            if (!response.ok) {
                const errorData = await response.json();
                console.error("Server error:", errorData);
                showPopup("Server Error", 
                    errorData.error || "Failed to generate questions. Please try another video.", 
                    "error");
                resetButtonState();
                return;
            }

            const data = await response.json();
            
            if (data.error && data.error === "Transcripts not available") {
                showPopup("Transcript Not Available", 
                    "This video doesn't have captions or transcripts available. You can try videos that have closed captions enabled.", 
                    "error");
                resetButtonState();
                return;
            }
            
            if (data.error && data.error.includes("Not enough reliable information")) {
                showPopup("Content Issue", 
                    "We couldn't generate enough questions from this video. Please try an educational video with more detailed content or clearly explained concepts.", 
                    "error");
                resetButtonState();
                return;
            }
            
            if (!data || !data.result || !Array.isArray(data.result) || data.result.length === 0) {
                console.error("Invalid response format:", data);
                showPopup("Error", 
                    "Failed to generate questions. Response format was unexpected.", 
                    "error");
                resetButtonState();
                return;
            }

            quizData = data.result;
            
            // Less restrictive validation - only filter out obviously problematic questions
            const problematicQuestions = quizData.filter(q => 
                q.question.length < 15 || 
                !q.options || 
                q.options.length !== 4 ||
                !q.options.includes(q.correctAnswer)
            );
            
            if (problematicQuestions.length > 0) {
                // Remove problematic questions rather than failing
                quizData = quizData.filter(q => !problematicQuestions.includes(q));
                
                if (quizData.length < 3) {
                    showPopup("Quality Issue", 
                        "We couldn't generate enough good quality questions from this video. Please try another educational video.", 
                        "error");
                    resetButtonState();
                    return;
                }
                
                // Just show a warning but proceed with the quiz
                showToast("Some questions were filtered out due to quality issues", "warning");
            }
            
            startQuiz();
            showToast(`Quiz generated with ${quizData.length} questions!`, "success");
            resetButtonState();
        } catch (error) {
            console.error("Fetch Error:", error);
            showToast("Failed to fetch questions. Please try again.", "error");
            resetButtonState();
        }
    });

    function resetButtonState() {
        btn.textContent = 'Get Questions';
        btn.disabled = false;
    }

    function extractVideoId(url) {
        // More comprehensive video ID extraction
        const patterns = [
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/i,     // Standard YouTube URL
            /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/i,                 // Shortened URL
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/i,        // Embed URL
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([^?]+)/i,            // Old embed URL
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/user\/[^\/]+\/([^?]+)/i, // User URL
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/[^\/]+\/([^?]+)/i,       // Channel URL
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                return match[1].split('&')[0]; // Remove any additional parameters
            }
        }

        // Fallback to the original method
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    function startQuiz() {
        currentQuestion = 0;
        score = 0;
        incorrectAnswers = [];

        quizContainer.innerHTML = '';
        resultContainer.style.display = "none";
        submitButton.style.display = "block";
        retryButton.classList.add("hide");
        showAnswerButton.classList.add("hide");

        displayQuestion();
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    function displayQuestion() {
        if (currentQuestion >= quizData.length) {
            displayResult();
            return;
        }

        const questionData = quizData[currentQuestion];
        const shuffledOptions = [...questionData.options];
        shuffleArray(shuffledOptions);

        quizContainer.innerHTML = `
            <div class="question-counter">Question ${currentQuestion + 1}/${quizData.length}</div>
            <div class="question">${questionData.question}</div>
            <div class="options"></div>
        `;

        const optionsContainer = quizContainer.querySelector(".options");

        shuffledOptions.forEach((option) => {
            const optionElement = document.createElement("label");
            
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "quiz";
            radio.value = option;

            optionElement.appendChild(radio);
            optionElement.appendChild(document.createTextNode(option));
            optionsContainer.appendChild(optionElement);
        });

        // Add animation
        quizContainer.classList.add('fade-in');
        setTimeout(() => quizContainer.classList.remove('fade-in'), 500);
    }

    function checkAnswer() {
        const selectedOption = document.querySelector('input[name="quiz"]:checked');
        if (!selectedOption) {
            showToast("Please select an answer", "error");
            return;
        }

        const answer = selectedOption.value;
        if (answer === quizData[currentQuestion].correctAnswer) {
            score++;
            showToast("Correct!", "success");
        } else {
            incorrectAnswers.push({
                question: quizData[currentQuestion].question,
                incorrectAnswer: answer,
                correctAnswer: quizData[currentQuestion].correctAnswer,
            });
            showToast("Incorrect", "error");
        }

        currentQuestion++;
        displayQuestion();
    }

    function displayResult() {
        resultContainer.innerHTML = `<h2>You scored ${score} out of ${quizData.length}!</h2>`;
        
        // Display percentage and message
        const percentage = (score / quizData.length) * 100;
        let message = "";
        
        if (percentage >= 90) message = "Excellent! You're a master!";
        else if (percentage >= 70) message = "Great job! You know your stuff!";
        else if (percentage >= 50) message = "Good effort! Keep learning!";
        else message = "Keep practicing! You'll improve!";
        
        resultContainer.innerHTML += `<p>${message}</p>`;
        
        resultContainer.style.display = "block";
        resultContainer.classList.add('fade-in');
        
        submitButton.style.display = "none";
        retryButton.classList.remove("hide");
        showAnswerButton.classList.remove("hide");
    }

    function showAnswer() {
        let incorrectAnswersHtml = incorrectAnswers
            .map(
                (item) => `
                <div class="answer-container">
                    <p class="question-highlight">${item.question}</p>
                    <p class="incorrect-answer"><strong>Your Answer:</strong> ${item.incorrectAnswer}</p>
                    <p class="correct-answer"><strong>Correct Answer:</strong> ${item.correctAnswer}</p>
                </div>`
            )
            .join("");
    
        if (incorrectAnswers.length === 0) {
            resultContainer.innerHTML = `
                <h2>Perfect Score!</h2>
                <p>You got all questions correct. Amazing job!</p>
            `;
        } else {
            resultContainer.innerHTML = `
                <h2>You scored ${score} out of ${quizData.length}</h2>
                <p>Here are the questions you missed:</p>
                ${incorrectAnswersHtml}
            `;
        }
    
        quizContainer.innerHTML = "";
        submitButton.style.display = "none";
        showAnswerButton.classList.add("hide");
    }

    function retryQuiz() {
        startQuiz();
    }

    // Event listeners
    submitButton.addEventListener("click", checkAnswer);
    retryButton.addEventListener("click", retryQuiz);
    showAnswerButton.addEventListener("click", showAnswer);

    // Allow pressing Enter in the URL input to trigger the button
    youtubeUrlInput.addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
            btn.click();
        }
    });

    // Toast notification function
    function showToast(message, type) {
        const toast = document.createElement("div");
        toast.className = `toast toast-${type}`;
        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.classList.add("fade-out");
            toast.addEventListener("transitionend", () => toast.remove());
        }, 3000);
    }

    function isValidYouTubeUrl(url) {
        // More comprehensive URL validation
        const regExp = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\/(watch\?v=|embed\/|v\/|shorts\/|user\/\S+\/|channel\/|c\/|playlist\?|watch\?.+&v=)([^#&?]*).*/;
        return regExp.test(url);
    }

    // Add popup message function
    function showPopup(title, message, type = 'info') {
        // Create overlay
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay';
        
        // Create popup container
        const popup = document.createElement('div');
        popup.className = `popup popup-${type}`;
        
        // Create popup content
        popup.innerHTML = `
            <div class="popup-header">
                <h3>${title}</h3>
                <button class="popup-close">&times;</button>
            </div>
            <div class="popup-body">
                <p>${message}</p>
            </div>
            <div class="popup-footer">
                <button class="btn-3d popup-ok">OK</button>
            </div>
        `;
        
        // Add to DOM
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        
        // Add animation
        setTimeout(() => {
            popup.classList.add('popup-show');
        }, 10);
        
        // Close functionality
        const closeBtn = popup.querySelector('.popup-close');
        const okBtn = popup.querySelector('.popup-ok');
        
        const closePopup = () => {
            popup.classList.remove('popup-show');
            setTimeout(() => {
                document.body.removeChild(overlay);
            }, 300);
        };
        
        closeBtn.addEventListener('click', closePopup);
        okBtn.addEventListener('click', closePopup);
    }
});
