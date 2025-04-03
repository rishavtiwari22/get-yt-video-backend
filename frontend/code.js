let quizData = [];
let currentQuestion = 0;
let score = 0;
let incorrectAnswers = [];

document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("btn");
    const quizContainer = document.getElementById("quiz");
    const resultContainer = document.getElementById("result");
    const submitButton = document.getElementById("submit");
    const retryButton = document.getElementById("retry");
    const showAnswerButton = document.getElementById("showAnswer");
    const questionCounter = document.getElementById("question-counter");

    btn.addEventListener("click", async () => {
        console.log("Serching for quiz...");
        const youtubeUrl = document.getElementById("youtube-url").value.trim();
        if (!youtubeUrl) {
            console.error("YouTube URL is required");
            return;
        }
        const videoId = extractVideoId(youtubeUrl);
        if (!videoId) {
            console.error("Invalid YouTube URL");
            return;
        }
        try {
            const response = await fetch("https://get-yt-question.vercel.app/get-transcript", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoId }),
            });

            const data = await response.json();
            if (!data || data.error || !Array.isArray(data.result) || data.result.length === 0) {
                console.error("No questions found or API error.");
                return;
            }

            quizData = data.result;
            console.log("Fetched Quiz Data:", quizData);

            startQuiz();
        } catch (error) {
            console.error("Fetch Error:", error);
        }
    });

    function extractVideoId(url) {
        const videoId1 = url.split('=');
        const videoId2 = videoId1[videoId1.length - 1];
        return videoId2;
    }

    function startQuiz() {
        currentQuestion = 0;
        score = 0;
        incorrectAnswers = [];

        quizContainer.style.display = "block";
        submitButton.style.display = "inline-block";
        retryButton.style.display = "none";
        showAnswerButton.style.display = "none";
        resultContainer.innerHTML = "";

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

        quizContainer.innerHTML = `
            <div class="question">${questionData.question}</div>
            <div class="options"></div>
        `;

        const optionsContainer = quizContainer.querySelector(".options");
        const shuffledOptions = [...questionData.options];
        shuffleArray(shuffledOptions);

        shuffledOptions.forEach((option) => {
            const optionElement = document.createElement("label");
            optionElement.className = "option";

            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "quiz";
            radio.value = option;

            optionElement.appendChild(radio);
            optionElement.appendChild(document.createTextNode(option));
            optionsContainer.appendChild(optionElement);
        });

        if (questionCounter) {
            questionCounter.textContent = `Question ${currentQuestion + 1} of ${quizData.length}`;
        }
    }

    function checkAnswer() {
        const selectedOption = document.querySelector('input[name="quiz"]:checked');
        if (!selectedOption) return;

        const answer = selectedOption.value;
        if (answer === quizData[currentQuestion].correctAnswer) {
            score++;
        } else {
            incorrectAnswers.push({
                question: quizData[currentQuestion].question,
                incorrectAnswer: answer,
                correctAnswer: quizData[currentQuestion].correctAnswer,
            });
        }

        currentQuestion++;
        displayQuestion();
    }

    function displayResult() {
        quizContainer.style.display = "none";
        submitButton.style.display = "none";
        retryButton.style.display = "inline-block";
        showAnswerButton.style.display = "inline-block";
        resultContainer.innerHTML = `You scored ${score} out of ${quizData.length}!`;
    }

    function retryQuiz() {
        document.getElementById("result").style.display = "none";
        startQuiz();
    }

    // function showAnswer() {
    //     let incorrectAnswersHtml = incorrectAnswers
    //         .map(
    //             (item) => `
    //         <p>
    //           <strong>Question:</strong> ${item.question}<br>
    //           <strong>Your Answer:</strong> ${item.incorrectAnswer}<br>
    //           <strong>Correct Answer:</strong> ${item.correctAnswer}
    //         </p>`
    //         )
    //         .join("");

    //     resultContainer.innerHTML = `
    //       <p>You scored ${score} out of ${quizData.length}!</p>
    //       <p>Incorrect Answers:</p>
    //       ${incorrectAnswersHtml}
    //     `;

    //     quizContainer.style.display = "none";
    //     submitButton.style.display = "none";
    //     retryButton.style.display = "inline-block";
    //     showAnswerButton.style.display = "none";
    // }

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
    
        resultContainer.innerHTML = `
            <p>You scored ${score} out of ${quizData.length}!</p>
            <p>Incorrect Answers:</p>
            ${incorrectAnswersHtml}
        `;
    
        quizContainer.style.display = "none";
        submitButton.style.display = "none";
        retryButton.style.display = "inline-block";
        showAnswerButton.style.display = "none";
    }
    


    submitButton.addEventListener("click", checkAnswer);
    retryButton.addEventListener("click", retryQuiz);
    showAnswerButton.addEventListener("click", showAnswer);


    document.getElementById("showAnswer").addEventListener("click", function () {
        document.getElementById("quiz").style.display = "none";
        document.getElementById("result").style.display = "block";
    });
    
});
