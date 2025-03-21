require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Configuration du stockage local
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Créer le dossier uploads s'il n'existe pas
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Fonction pour chiffrer les fichiers PDF
const encryptFile = (filePath, outputFilePath, secretKey) => {
    return new Promise((resolve, reject) => {
        const iv = crypto.randomBytes(16);
        const key = crypto.scryptSync(secretKey, 'salt', 32);
        
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const input = fs.createReadStream(filePath);
        const output = fs.createWriteStream(outputFilePath);

        output.write(iv);
        input.pipe(cipher).pipe(output)
            .on('finish', () => {
                resolve();
            })
            .on('error', (err) => {
                reject(err);
            });
    });
};

// Fonction pour déchiffrer les fichiers PDF
const decryptFile = (filePath, outputFilePath, secretKey) => {
    return new Promise((resolve, reject) => {
        const input = fs.createReadStream(filePath);
        const iv = Buffer.alloc(16);
        
        input.once('readable', () => {
            input.read(iv);
        });

        const key = crypto.scryptSync(secretKey, 'salt', 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        const output = fs.createWriteStream(outputFilePath);

        input.pipe(decipher).pipe(output)
            .on('finish', () => {
                resolve();
            })
            .on('error', (err) => {
                reject(err);
            });
    });
};

// Fonction pour sauvegarder le fichier localement
const saveFileLocally = async (file, role, userId) => {
    const fileName = `${Date.now()}_${file.originalname}`;
    const filePath = path.join(UPLOAD_DIR, `${role}_${userId}_${fileName}`);
    
    await fs.promises.copyFile(file.path, filePath);
    await fs.promises.unlink(file.path); // Supprimer le fichier temporaire
    
    return {
        path: filePath,
        fileName: fileName
    };
};

// Restreindre l'accès aux fichiers
const canAccessFile = (user, fileOwnerId, userRole) => {
    if (userRole === 'professeur') return true;
    if (userRole === 'etudiant' && user.id === fileOwnerId) return true;
    return false;
};

// API : Upload d'un fichier
const uploadPDF = async (req, res) => {
    const { user, role } = req.body;
    const pdfFile = req.file;
    const secretKey = process.env.ENCRYPTION_KEY;

    if (!pdfFile) {
        return res.status(400).json({ error: "Aucun fichier n'a été uploadé" });
    }

    if (pdfFile.mimetype !== 'application/pdf') {
        return res.status(400).json({ error: "Seuls les fichiers PDF sont autorisés" });
    }

    try {
        const savedFile = await saveFileLocally(pdfFile, role, user.id);
        const encryptedFilePath = path.join(UPLOAD_DIR, `encrypted_${path.basename(savedFile.path)}`);
        
        await encryptFile(savedFile.path, encryptedFilePath, secretKey);
        await fs.promises.unlink(savedFile.path); // Supprimer le fichier non chiffré

        res.json({ 
            message: "Fichier uploadé avec succès",
            fileName: savedFile.fileName
        });
    } catch (error) {
        console.error("Erreur lors de l'upload du fichier PDF:", error);
        res.status(500).json({ error: "Erreur lors de l'upload", details: error.message });
    }
};

// API : Récupérer un fichier
const getDownloadLink = async (req, res) => {
    const { user, role, fileOwnerId, fileName } = req.body;

    if (!canAccessFile(user, fileOwnerId, role)) {
        return res.status(403).json({ error: "Accès refusé" });
    }

    try {
        const encryptedFilePath = path.join(UPLOAD_DIR, `encrypted_${fileName}`);
        if (!fs.existsSync(encryptedFilePath)) {
            return res.status(404).json({ error: "Fichier non trouvé" });
        }

        const tempFilePath = path.join(UPLOAD_DIR, `temp_${fileName}`);
        await decryptFile(encryptedFilePath, tempFilePath, process.env.ENCRYPTION_KEY);

        res.download(tempFilePath, fileName, (err) => {
            if (err) {
                console.error("Erreur lors du téléchargement:", err);
            }
            // Supprimer le fichier temporaire après l'envoi
            fs.unlink(tempFilePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error("Erreur lors de la suppression du fichier temporaire:", unlinkErr);
                }
            });
        });
    } catch (error) {
        console.error("Erreur lors de la récupération du fichier:", error);
        res.status(500).json({ error: "Erreur lors de la récupération du fichier", details: error.message });
    }
};

module.exports = {
    uploadPDF,
    getDownloadLink,
    saveFileLocally
};