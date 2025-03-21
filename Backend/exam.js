require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ollama = require('ollama'); // Pour DeepSeek
const mysql = require('mysql2/promise');
const multer = require('multer');  // Ajout de multer pour gérer les fichiers
const { saveFileLocally } = require('./storage');

// Validation du type de fichier
const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Seuls les fichiers PDF sont autorisés.'), false);
    }
};

// Configuration de multer pour l'upload des fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // Limite à 10MB
    }
});

// Connexion à la base de données MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 100,
    queueLimit: 0
});

// Fonction pour calculer l'index de Jaccard (détection de plagiat)
const calculateJaccardIndex = (textA, textB) => {
    const setA = new Set(textA.split(/\s+/)); // Divise le texte A en mots uniques
    const setB = new Set(textB.split(/\s+/)); // Divise le texte B en mots uniques

    const intersection = [...setA].filter(word => setB.has(word)).length; // Mots communs
    const union = new Set([...setA, ...setB]).size; // Union des mots uniques

    return intersection / union; // Calcul de l'index de Jaccard
};

// API : Déposer un sujet d'examen (professeurs uniquement)
const uploadExamTopic = async (req, res) => {
    const { professorId, format, title } = req.body;
    const examFile = req.file;

    if (!examFile) {
        return res.status(400).json({ error: "Aucun fichier n'a été uploadé." });
    }

    if (!format || !title) {
        return res.status(400).json({ error: "Format et titre requis." });
    }

    try {
        const savedFile = await saveFileLocally(examFile, 'exam', professorId);

        // Sauvegarde dans la base de données
        const [result] = await pool.execute(
            'INSERT INTO exam_topics (professor_id, title, file_path, format) VALUES (?, ?, ?, ?)',
            [professorId, title, savedFile.path, format]
        );

        res.json({ 
            message: "Sujet d'examen déposé avec succès",
            fileName: savedFile.fileName,
            examTopicId: result.insertId
        });
    } catch (error) {
        console.error("Erreur lors de l'upload du sujet d'examen :", error);
        res.status(500).json({ 
            error: "Erreur lors de l'upload", 
            details: error.message 
        });
    }
};

// API : Soumettre une réponse d'examen (étudiants)
const submitExamAnswer = async (req, res) => {
    const { studentId, examTopicId } = req.body;
    const answerFile = req.file;

    if (!answerFile) {
        return res.status(400).json({ error: "Aucun fichier n'a été uploadé." });
    }

    if (!examTopicId) {
        return res.status(400).json({ error: "ID du sujet d'examen requis." });
    }

    try {
        // Vérifier si le sujet d'examen existe
        const [examTopic] = await pool.execute(
            'SELECT * FROM exam_topics WHERE id = ?',
            [examTopicId]
        );

        if (examTopic.length === 0) {
            return res.status(404).json({ error: "Sujet d'examen non trouvé." });
        }

        const savedFile = await saveFileLocally(answerFile, 'answer', studentId);

        // Sauvegarde dans la base de données
        const [result] = await pool.execute(
            'INSERT INTO exam_answers (student_id, exam_topic_id, file_path) VALUES (?, ?, ?)',
            [studentId, examTopicId, savedFile.path]
        );

        res.json({ 
            message: "Réponse soumise avec succès",
            fileName: savedFile.fileName,
            answerId: result.insertId
        });
    } catch (error) {
        console.error("Erreur lors de la soumission de la réponse :", error);
        res.status(500).json({ 
            error: "Erreur lors de la soumission", 
            details: error.message 
        });
    }
};

// API : Corriger une copie via IA (DeepSeek)
const correctExamAnswer = async (req, res) => {
    const { answerText, studentId, examTopicId } = req.body;

    // Vérification de la présence du texte à corriger
    if (!answerText) {
        return res.status(400).json({ error: "Texte de la réponse requis." });
    }

    try {
        // Communication avec l'IA DeepSeek via Ollama
        const response = await ollama.chat({
            model: "deepseek-coder",
            messages: [
                {
                    role: "user",
                    content: `Corrige cette réponse d'examen et attribue une note sur 20 avec des explications détaillées : \n\n${answerText}`
                }
            ]
        });

        // Extraction de la réponse générée par l'IA
        const aiFeedback = response.message?.content || "Aucun retour fourni par l'IA.";

        // Sauvegarde de la correction dans la base de données (ajout d'une note et feedback)
        await pool.execute(
            'UPDATE exam_answers SET ai_feedback = ?, score = ? WHERE student_id = ? AND exam_topic_id = ?',
            [aiFeedback, response.score, studentId, examTopicId]
        );

        // Retour au client
        res.json({
            message: "Correction effectuée.",
            feedback: aiFeedback
        });
    } catch (error) {
        console.error("Erreur lors de la correction avec DeepSeek :", error);
        res.status(500).json({
            error: "Erreur lors de la correction avec DeepSeek.",
            details: error.message
        });
    }
};

// API : Détecter le plagiat avec l'algorithme de Jaccard
const detectPlagiarism = async (req, res) => {
    const { studentText } = req.body;
    if (!studentText) {
        return res.status(400).json({ error: "Texte de la réponse requis." });
    }

    try {
        // Récupère toutes les copies soumises depuis la base de données
        const [rows] = await pool.execute("SELECT answer_text FROM exam_answers");

        let highestJaccard = 0;
        let mostSimilarText = "";

        for (const row of rows) {
            const similarity = calculateJaccardIndex(studentText, row.answer_text);
            if (similarity > highestJaccard) {
                highestJaccard = similarity;
                mostSimilarText = row.answer_text;
            }
        }

        res.json({
            message: "Analyse de plagiat terminée.",
            jaccardIndex: highestJaccard,
            isPlagiarized: highestJaccard > 0.5, // Seuil à 50%
            similarText: mostSimilarText
        });
    } catch (error) {
        console.error("Erreur lors de la détection de plagiat :", error);
        res.status(500).json({ error: "Erreur lors de la détection de plagiat", details: error.message });
    }
};

module.exports = {
    uploadExamTopic,
    submitExamAnswer,
    correctExamAnswer,
    detectPlagiarism,
    upload
};