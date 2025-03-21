const express = require('express');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const speakeasy = require('speakeasy');
require('dotenv').config();

// Validation de l'email
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Initialisation de MySQL
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 100,
    queueLimit: 0
});

// Variables d'environnement
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL;

// Configuration de Passport Google OAuth2
passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails[0].value;
        const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);

        if (rows.length > 0) {
            return done(null, rows[0]);
        } else {
            return done(null, false, { message: 'Utilisateur non trouvé' });
        }
    } catch (err) {
        return done(err);
    }
}));

// Fonction de connexion locale
const login = async (req, res) => {
    try {
        const { email, password, role } = req.body;

        // Vérification des champs requis
        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Tous les champs sont requis' });
        }

        // Vérification du format de l'email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Format d\'email invalide' });
        }

        // Vérification du rôle
        if (!['professeur', 'etudiant'].includes(role)) {
            return res.status(400).json({ error: 'Rôle invalide' });
        }

        // Recherche de l'utilisateur dans la base de données
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE email = ? AND role = ?',
            [email, role]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        const user = users[0];

        // Vérification du mot de passe (à implémenter avec bcrypt)
        if (password !== user.password) {
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        // Création du token JWT
        const token = jwt.sign(
            { 
                id: user.id,
                email: user.email,
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Envoi de la réponse
        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// Fonction pour activer la double authentification (2FA)
const enable2FA = async (req, res) => {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Email valide requis.' });
    }

    try {
        const secret = speakeasy.generateSecret({ length: 20 });

        await pool.execute(
            'UPDATE users SET twoFASecret = ? WHERE email = ?',
            [secret.base32, email]
        );

        res.json({
            message: '2FA activée.',
            secret: secret.base32,
            otpauth_url: secret.otpauth_url
        });
    } catch (err) {
        console.error('Erreur activation 2FA:', err);
        res.status(500).json({ error: 'Erreur serveur.', details: err.message });
    }
};

// Endpoint pour l'authentification Google OAuth2
const googleAuth = passport.authenticate('google', { scope: ['profile', 'email'] });

// Callback Google OAuth2
const googleAuthCallback = [
    passport.authenticate('google', { session: false, failureRedirect: '/login' }),
    (req, res) => {
        const token = jwt.sign({
            id: req.user.id,
            email: req.user.email,
            role: req.user.role
        }, JWT_SECRET, { expiresIn: '1h' });

        res.json({ 
            token, 
            user: { 
                id: req.user.id, 
                email: req.user.email,
                role: req.user.role 
            } 
        });
    }
];

module.exports = {
    login,
    enable2FA,
    googleAuth,
    googleAuthCallback
};
