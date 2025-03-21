import React, { useState, useEffect } from "react";
import {
  Container,
  Card,
  CardContent,
  TextField,
  Button,
  Select,
  MenuItem,
  Typography,
  List,
  ListItem,
} from "@mui/material";
import axios from "axios";
import ReactECharts from "echarts-for-react";

// Constante pour l'URL de base de l'API
const API_BASE_URL = "http://localhost:3000";

// Configuration d'Axios pour inclure le token dans toutes les requêtes
axios.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Fonction pour vérifier si l'utilisateur est connecté
const checkAuth = () => {
    const token = localStorage.getItem('token');
    return !!token;
};

// Fonction pour vérifier le rôle de l'utilisateur
const getUserRole = () => {
    const user = JSON.parse(localStorage.getItem('user'));
    return user?.role;
};

const Dashboard = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(localStorage.getItem("role") || "");
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem("token"));
  const [answerFile, setAnswerFile] = useState(null);
  const [examFile, setExamFile] = useState(null);
  const [examTitle, setExamTitle] = useState("");
  const [examFormat, setExamFormat] = useState("");
  const [grade, setGrade] = useState(null);
  const [correctedCopies, setCorrectedCopies] = useState([]);
  const [examTopics, setExamTopics] = useState([]);
  const [chartOptions, setChartOptions] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [darkMode, setDarkMode] = useState(localStorage.getItem("darkMode") === "true");
  const [success, setSuccess] = useState("");

  const roles = ["professeur", "etudiant"];

  // Gestion du mode sombre
  useEffect(() => {
    document.body.classList.toggle("dark-mode", darkMode);
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode((prev) => !prev);
  };

  // Fonction de connexion
  const login = async (email, password, role) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/login`, {
        email,
        password,
        role
      });

      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        setRole(response.data.user.role);
        setIsAuthenticated(true);
        return response.data;
      }
      throw new Error('Token non reçu');
    } catch (error) {
      console.error('Erreur de connexion:', error);
      throw error;
    }
  };

  const downloadExam = async (fileKey) => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/get-download-link`,
        { fileKey },
        { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } }
      );
      window.open(response.data.downloadLink, "_blank");
    } catch (error) {
      console.error("Erreur lors du téléchargement de l'examen", error);
    }
  };

  const submitAnswer = async () => {
    try {
      const formData = new FormData();
      formData.append("answerFile", answerFile);
      await axios.post(`${API_BASE_URL}/submit-exam-answer`, formData, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      alert("Réponse envoyée");
    } catch (error) {
      console.error("Erreur lors de l'envoi de la réponse", error);
    }
  };

  const uploadExam = async () => {
    try {
      const formData = new FormData();
      formData.append("examFile", examFile);
      formData.append("title", examTitle);
      formData.append("format", examFormat);
      
      const token = localStorage.getItem("token");
      if (!token) {
        setErrorMessage("Vous devez être connecté pour envoyer un examen");
        return;
      }

      await axios.post(`${API_BASE_URL}/upload-exam-topic`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data'
          }
        }
      );
      setSuccess("Examen envoyé avec succès");
    } catch (error) {
      console.error("Erreur lors de l'envoi de l'examen", error);
      if (error.response?.status === 403) {
        setErrorMessage("Vous n'avez pas les droits pour envoyer un examen");
      } else {
        setErrorMessage("Erreur lors de l'envoi de l'examen");
      }
    }
  };

  // Fonction pour récupérer les sujets d'examen
  const fetchExamTopics = async () => {
    try {
      if (!checkAuth() || getUserRole() !== 'etudiant') {
        throw new Error('Accès non autorisé');
      }
      const response = await axios.get(`${API_BASE_URL}/exam-topics`);
      setExamTopics(response.data);
    } catch (error) {
      console.error('Erreur lors de la récupération des sujets d\'examen:', error);
      setErrorMessage('Erreur lors de la récupération des sujets d\'examen');
    }
  };

  // Fonction pour récupérer les résultats
  const fetchResults = async () => {
    try {
      if (!checkAuth() || getUserRole() !== 'etudiant') {
        throw new Error('Accès non autorisé');
      }
      const response = await axios.get(`${API_BASE_URL}/student-results`);
      setGrade(response.data.grade);
      setChartOptions({
        title: { text: "Évolution des notes" },
        xAxis: { type: "category", data: response.data.dates },
        yAxis: { type: "value" },
        series: [{ name: "Note", type: "line", data: response.data.grades }],
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des résultats:', error);
      setErrorMessage('Erreur lors de la récupération des résultats');
    }
  };

  // Fonction pour récupérer les statistiques
  const fetchStatistics = async () => {
    try {
      if (!checkAuth() || getUserRole() !== 'professeur') {
        throw new Error('Accès non autorisé');
      }
      const response = await axios.get(`${API_BASE_URL}/stats`);
      setChartOptions({
        title: { text: "Statistiques globales" },
        xAxis: { type: "category", data: ["Total étudiants", "Total réponses", "Note moyenne", "Note min", "Note max"] },
        yAxis: { type: "value" },
        series: [{ 
          name: "Valeurs", 
          type: "bar", 
          data: [
            response.data.total_students,
            response.data.total_answers,
            response.data.average_grade,
            response.data.min_grade,
            response.data.max_grade
          ] 
        }]
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      setErrorMessage('Erreur lors de la récupération des statistiques');
    }
  };

  // Fonction pour récupérer les réponses des étudiants
  const fetchExamAnswers = async () => {
    try {
      if (!checkAuth() || getUserRole() !== 'professeur') {
        throw new Error('Accès non autorisé');
      }
      const response = await axios.get(`${API_BASE_URL}/exam-answers`);
      setCorrectedCopies(response.data);
    } catch (error) {
      console.error('Erreur lors de la récupération des réponses des étudiants:', error);
      setErrorMessage('Erreur lors de la récupération des réponses des étudiants');
    }
  };

  useEffect(() => {
    if (checkAuth()) {
      if (getUserRole() === "etudiant") {
        fetchExamTopics();
        fetchResults();
      } else if (getUserRole() === "professeur") {
        fetchExamAnswers();
        fetchStatistics();
      }
    }
  }, [isAuthenticated]);

  return (
    <Container className="dashboard-container">
      <Button onClick={toggleDarkMode} className="fade-in">
        {darkMode ? "Mode Clair" : "Mode Sombre"}
      </Button>

      {!isAuthenticated ? (
        <Card className="login-card fade-in">
          <CardContent>
            <Typography variant="h5" textAlign="center">
              Connexion
            </Typography>
            <Select fullWidth value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </Select>
            <TextField fullWidth label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField fullWidth label="Mot de passe" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button fullWidth variant="contained" onClick={() => login(email, password, role)} sx={{ backgroundColor: "var(--primary)", "&:hover": { backgroundColor: "var(--primary-hover)" } }}>
              Se connecter
            </Button>
            {errorMessage && <Typography color="error">{errorMessage}</Typography>}
          </CardContent>
        </Card>
      ) : (
        <Card className="fade-in">
          <Typography variant="h5">{getUserRole() === "etudiant" ? "Tableau de Bord Étudiant" : "Tableau de Bord Professeur"}</Typography>

          {getUserRole() === "professeur" && (
            <>
              <CardContent>
                <Typography variant="h6">Envoyer un nouvel examen</Typography>
                <TextField
                  fullWidth
                  label="Titre de l'examen"
                  value={examTitle}
                  onChange={(e) => setExamTitle(e.target.value)}
                  margin="normal"
                />
                <Select
                  fullWidth
                  value={examFormat}
                  onChange={(e) => setExamFormat(e.target.value)}
                  margin="normal"
                >
                  <MenuItem value="pdf">PDF</MenuItem>
                  <MenuItem value="docx">DOCX</MenuItem>
                  <MenuItem value="txt">TXT</MenuItem>
                </Select>
                <input
                  type="file"
                  onChange={(e) => setExamFile(e.target.files[0])}
                  style={{ margin: '20px 0' }}
                  accept=".pdf,.docx,.txt"
                />
                <Button 
                  variant="contained" 
                  onClick={uploadExam} 
                  disabled={!examFile || !examTitle || !examFormat}
                  sx={{ 
                    backgroundColor: "var(--primary)", 
                    "&:hover": { backgroundColor: "var(--primary-hover)" },
                    marginTop: "10px"
                  }}
                >
                  Envoyer l'examen
                </Button>
                {success && <Typography color="success" sx={{ mt: 1 }}>{success}</Typography>}
              </CardContent>

              <CardContent>
                <Typography variant="h6">Réponses des étudiants</Typography>
              <List>
                  {correctedCopies.map((copy) => (
                    <ListItem key={copy.id}>
                      {copy.student_email} - Note: {copy.grade} - 
                      <Button 
                        onClick={() => console.log(copy.id)}
                        sx={{ ml: 1 }}
                      >
                        Voir la correction
                      </Button>
                  </ListItem>
                ))}
              </List>
              {chartOptions && <ReactECharts option={chartOptions} className="chart-container" />}
              </CardContent>
            </>
          )}

          {getUserRole() === "etudiant" && (
            <>
              <CardContent>
                <Typography variant="h6">Sujets d'examen disponibles</Typography>
              <List>
                  {examTopics.map((topic) => (
                    <ListItem key={topic.id}>
                      {topic.title} ({topic.format})
                      <Button 
                        onClick={() => downloadExam(topic.fileKey)}
                        sx={{ ml: 1 }}
                      >
                        Télécharger
                      </Button>
                  </ListItem>
                ))}
              </List>
              </CardContent>

              <CardContent>
                <Typography variant="h6">Envoyer votre réponse</Typography>
                <input
                  type="file"
                  onChange={(e) => setAnswerFile(e.target.files[0])}
                  style={{ margin: '20px 0' }}
                  accept=".pdf,.docx,.txt"
                />
                <Button 
                  variant="contained" 
                  onClick={submitAnswer} 
                  disabled={!answerFile}
                  sx={{ 
                    backgroundColor: "var(--primary)", 
                    "&:hover": { backgroundColor: "var(--primary-hover)" },
                    marginTop: "10px"
                  }}
                >
                  Envoyer la réponse
                </Button>
                {grade !== null && (
                  <Typography sx={{ mt: 2 }}>
                    Dernière note obtenue: {grade}
                  </Typography>
                )}
                {chartOptions && <ReactECharts option={chartOptions} className="chart-container" />}
              </CardContent>
            </>
          )}
        </Card>
      )}
    </Container>
  );
};

export default Dashboard;