// Importation des dépendances
const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const passport = require('passport');
const mysql = require('mysql2/promise');
require('dotenv').config();

// Configuration de la base de données
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'examenbd',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Importation des fonctions des autres fichiers
const { uploadExamTopic, submitExamAnswer, correctExamAnswer, detectPlagiarism } = require('./exam');
const { uploadPDF, getDownloadLink } = require('./storage');
const { login, enable2FA } = require('./auth'); // Authentification & 2FA

// Initialisation de l'application Express
const app = express();

// Configuration de multer pour l'upload de fichiers
const upload = multer({ 
    dest: 'uploads/',
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    }
});

// Middleware pour gérer l'authentification via JWT
app.use(express.json()); // Middleware pour analyser les corps JSON des requêtes
app.use(cors()); // Middleware CORS pour autoriser les requêtes inter-domaines
app.use(passport.initialize()); // Initialisation de Passport

// Middleware pour gérer l'authentification via JWT
const authenticateJWT = (req, res, next) => {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Token manquant. Connectez-vous pour accéder.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Token invalide ou expiré.' });
        }
        req.user = user;
        next();
    });
};

// Middleware pour vérifier les rôles utilisateur
const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (req.user.role !== requiredRole) {
            return res.status(403).json({ error: 'Accès interdit pour ce rôle.' });
        }
        next();
    };
};

// Routes pour l'authentification et la gestion des utilisateurs
app.post('/login', login);
app.post('/enable-2fa', authenticateJWT, enable2FA);

// Routes pour les sujets d'examen (professeurs uniquement)
app.post('/upload-exam-topic', authenticateJWT, checkRole('professeur'), upload.single('examFile'), uploadExamTopic);

// Routes pour les réponses d'examen (étudiants uniquement)
app.post('/submit-exam-answer', authenticateJWT, checkRole('etudiant'), upload.single('answerFile'), submitExamAnswer);

// Route pour obtenir les sujets d'examen (étudiants uniquement)
app.get('/exam-topics', authenticateJWT, checkRole('etudiant'), async (req, res) => {
    try {
        const [topics] = await pool.execute(`
            SELECT id, title, format, created_at 
            FROM exam_topics 
            ORDER BY created_at DESC
        `);
        res.json(topics);
    } catch (error) {
        console.error('Erreur lors de la récupération des sujets:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour obtenir les résultats d'un étudiant
app.get('/student-results', authenticateJWT, checkRole('etudiant'), async (req, res) => {
    try {
        const studentId = req.user.id;
        const [results] = await pool.execute(`
            SELECT ea.grade, ea.submitted_at, et.title
            FROM exam_answers ea
            JOIN exam_topics et ON ea.exam_topic_id = et.id
            WHERE ea.student_id = ?
            ORDER BY ea.submitted_at DESC
        `, [studentId]);

        // Préparer les données pour le graphique
        const grades = results.map(r => r.grade || 0);
        const dates = results.map(r => new Date(r.submitted_at).toLocaleDateString());
        
        res.json({
            grade: grades[0] || null, // Dernière note
            grades: grades,
            dates: dates
        });
    } catch (error) {
        console.error('Erreur lors de la récupération des résultats:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour obtenir les réponses des étudiants (professeurs uniquement)
app.get('/exam-answers', authenticateJWT, checkRole('professeur'), async (req, res) => {
    try {
        const [answers] = await pool.execute(`
            SELECT ea.*, u.email as student_email, et.title as exam_title 
            FROM exam_answers ea 
            JOIN users u ON ea.student_id = u.id 
            JOIN exam_topics et ON ea.exam_topic_id = et.id
            ORDER BY ea.submitted_at DESC
        `);
        res.json(answers);
    } catch (error) {
        console.error('Erreur lors de la récupération des réponses:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour obtenir les statistiques (professeurs uniquement)
app.get('/stats', authenticateJWT, checkRole('professeur'), async (req, res) => {
    try {
        const [stats] = await pool.execute(`
            SELECT 
                COUNT(DISTINCT ea.student_id) as total_students,
                COUNT(ea.id) as total_answers,
                AVG(ea.grade) as average_grade,
                MIN(ea.grade) as min_grade,
                MAX(ea.grade) as max_grade
            FROM exam_answers ea
        `);
        res.json(stats[0]);
    } catch (error) {
        console.error('Erreur lors de la récupération des statistiques:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour corriger une réponse d'examen via IA (tous rôles authentifiés)
app.post('/correct-exam-answer', authenticateJWT, correctExamAnswer);

// Route pour détecter le plagiat (tous rôles authentifiés)
app.post('/detect-plagiarism', authenticateJWT, detectPlagiarism);

// Routes pour la gestion des fichiers PDF
app.post('/upload-pdf', authenticateJWT, upload.single('pdfFile'), uploadPDF);
app.post('/get-download-link', authenticateJWT, getDownloadLink);

// Route d'accueil
app.get('/', (req, res) => {
    res.send`(Bienvenue sur le backend de l'application !)`;
});

// Middleware global pour gérer les erreurs
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json`({ error: 'Une erreur inattendue s'est produite.' })`;
});

// Démarrage du serveur
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        app.listen(PORT, () => {
            console.log(`Serveur démarré sur le port ${PORT}`);
        });
    } catch (error) {
        if (error.code === 'EADDRINUSE') {
            console.error(`Le port ${PORT} est déjà utilisé. Essayez un autre port.`);
        } else {
            console.error('Erreur lors du démarrage du serveur:', error);
        }
        process.exit(1);
    }
};

startServer();