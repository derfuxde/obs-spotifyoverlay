const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Spotify Configuration
const SPOTIFY_CONFIG = {
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://192.168.56.1:8080/callback',
    scopes: [
        'user-read-currently-playing',
        'user-read-playback-state',
        'streaming',
        'user-read-email',
        'user-read-private'
    ]
};

// In-Memory Session Storage (In Production: Use Redis/Database)
const sessions = new Map();

// Helper Functions
function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex');
}

function base64Encode(str) {
    return Buffer.from(str).toString('base64');
}

// Routes

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get Spotify Auth URL
app.get('/auth/spotify', (req, res) => {
    console.log("try sport")
    try {
        if (!SPOTIFY_CONFIG.clientId) {
            return res.status(500).json({ error: 'Spotify Client ID nicht konfiguriert' });
        }

        const state = generateRandomString(16);
        const sessionId = generateRandomString(32);
        
        // Store state in session
        sessions.set(sessionId, { state, timestamp: Date.now() });
        
        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.append('response_type', 'code');
        authUrl.searchParams.append('client_id', SPOTIFY_CONFIG.clientId);
        authUrl.searchParams.append('scope', SPOTIFY_CONFIG.scopes.join(' '));
        authUrl.searchParams.append('redirect_uri', SPOTIFY_CONFIG.redirectUri);
        authUrl.searchParams.append('state', state);

        console.log("👉 Spotify Auth-Link:", authUrl.toString());
        
        res.json({
            authUrl: authUrl.toString(),
            state: state,
            sessionId: sessionId
        });
    } catch (error) {
        console.error('Error generating auth URL:', error);
        res.status(500).json({ error: 'Interner Serverfehler' });
    }
});

app.post('/auth/spotify/callback', async (req, res) => {
    const { code, state } = req.body;

    if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state' });
    }

    // Finde die Session zum übermittelten State
    let sessionId = null;
    for (const [id, session] of sessions.entries()) {
        if (session.state === state) {
            sessionId = id;
            break;
        }
    }

    if (!sessionId) {
        return res.status(400).json({ error: 'Invalid state' });
    }

    try {
        console.log("Code:", code);
        console.log("State:", state);
        console.log("Redirect URI:", SPOTIFY_CONFIG.redirectUri);

        const tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: SPOTIFY_CONFIG.redirectUri,
                client_id: SPOTIFY_CONFIG.clientId,
                client_secret: SPOTIFY_CONFIG.clientSecret
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        
        


        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        
        

        sessions.set(sessionId, {
            ...sessions.get(sessionId),
            accessToken: access_token,
            refreshToken: refresh_token,
            expiresAt: Date.now() + expires_in * 1000
        });

        

        return res.json({
            access_token,
            refresh_token,
            expires_in
        });

    } catch (err) {
        console.error('Token-Austausch fehlgeschlagen:', err.response?.data || err.message);
        return res.status(500).json({ error: 'Token exchange failed' });
    }
});



app.get('/callback', (req, res) => {
    const { code, state, error } = req.query;

    console.log("Spotify Callback → redirect to auth-result.html");

    if (error) {
        return res.redirect(`/auth-result.html?error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
        return res.redirect('/auth-result.html?error=missing_parameters');
    }

    // Kein Token-Tausch hier!
    return res.redirect(`/auth-result.html?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
});




// Get Session Status
app.get('/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
        return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    
    res.json({
        connected: !!session.accessToken,
        expiresAt: session.expiresAt,
        needsRefresh: session.expiresAt < Date.now()
    });
});

// Refresh Token
app.post('/auth/refresh', async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'Session ID erforderlich' });
    }
    
    const session = sessions.get(sessionId);
    if (!session || !session.refreshToken) {
        return res.status(404).json({ error: 'Session oder Refresh Token nicht gefunden' });
    }
    
    try {
        const tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: session.refreshToken,
                client_id: SPOTIFY_CONFIG.clientId,
                client_secret: SPOTIFY_CONFIG.clientSecret
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        const { access_token, expires_in, refresh_token } = tokenResponse.data;
        
        // Update session
        sessions.set(sessionId, {
            ...session,
            accessToken: access_token,
            refreshToken: refresh_token || session.refreshToken,
            expiresAt: Date.now() + (expires_in * 1000)
        });
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Token refresh error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Token-Erneuerung fehlgeschlagen' });
    }
});

app.get('/spotify/lyrics/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);

    if (!session || !session.accessToken) {
        return res.status(401).json({ error: 'Nicht authentifiziert' });
    }

    try {
        // Aktuellen Spotify-Track abrufen
        const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: {
                'Authorization': `Bearer ${session.accessToken}`
            }
        });

        if (response.status === 204 || !response.data?.item) {
            return res.json({ playing: false, message: "Kein Song wird aktuell gespielt." });
        }

        const track = response.data.item;
        const artist = track.artists[0].name;
        const title = track.name;

        // Lyrics abrufen von lyrics.ovh
        const lyricsRes = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        const lyricsData = await lyricsRes.json();

        return res.json({
            playing: true,
            artist,
            title,
            lyrics: lyricsData.lyrics || "Keine Lyrics gefunden."
        });

    } catch (error) {
        console.error('Lyrics retrieval error:', error.message);
        return res.status(500).json({ error: true, message: "Fehler beim Abrufen der Lyrics." });
    }
});


// Get Currently Playing Track
app.get('/spotify/currently-playing/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session || !session.accessToken) {
        return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    
    // Check if token needs refresh
    if (session.expiresAt < Date.now()) {
        try {
            await refreshTokenForSession(sessionId);
        } catch (error) {
            return res.status(401).json({ error: 'Token-Erneuerung fehlgeschlagen' });
        }
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: {
                'Authorization': `Bearer ${session.accessToken}`
            }
        });
        
        if (response.status === 204) {
            return res.json({ playing: false });
        }
        
        const data = response.data;
        
        // Transform data for frontend
        const trackData = {
            playing: data.is_playing,
            track: {
                name: data.item?.name || 'Unbekannt',
                artist: data.item?.artists?.map(a => a.name).join(', ') || 'Unbekannt',
                album: data.item?.album?.name || 'Unbekannt',
                image: data.item?.album?.images?.[0]?.url || null,
                duration: data.item?.duration_ms || 0,
                progress: data.progress_ms || 0,
                external_url: data.item?.external_urls?.spotify || null
            },
            device: {
                name: data.device?.name || 'Unbekannt',
                type: data.device?.type || 'Computer'
            }
        };
        
        res.json(trackData);
        
    } catch (error) {
        console.error('Currently playing error:', error.response?.data || error.message);
        
        if (error.response?.status === 401) {
            res.status(401).json({ error: 'Token ungültig' });
        } else if (error.response?.status === 429) {
            res.status(429).json({ error: 'Rate limit erreicht' });
        } else {
            res.status(500).json({ error: 'Fehler beim Abrufen der aktuellen Musik' });
        }
    }
});

// Get Player State
app.get('/spotify/player/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session || !session.accessToken) {
        return res.status(401).json({ error: 'Nicht authentifiziert' });
    }
    
    try {
        const response = await axios.get('https://api.spotify.com/v1/me/player', {
            headers: {
                'Authorization': `Bearer ${session.accessToken}`
            }
        });
        
        if (response.status === 204) {
            return res.json({ active: false });
        }
        
        res.json(response.data);
        
    } catch (error) {
        console.error('Player state error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Fehler beim Abrufen des Player-Status' });
    }
});

// Helper function to refresh token for a session
async function refreshTokenForSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || !session.refreshToken) {
        throw new Error('Session oder Refresh Token nicht gefunden');
    }
    
    const tokenResponse = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken,
            client_id: SPOTIFY_CONFIG.clientId,
            client_secret: SPOTIFY_CONFIG.clientSecret
        }),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );
    
    const { access_token, expires_in, refresh_token } = tokenResponse.data;
    
    sessions.set(sessionId, {
        ...session,
        accessToken: access_token,
        refreshToken: refresh_token || session.refreshToken,
        expiresAt: Date.now() + (expires_in * 1000)
    });
}

// Clean up expired sessions (every 1 hour)
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        // Remove sessions older than 24 hours
        if (session.timestamp && (now - session.timestamp) > 24 * 60 * 60 * 1000) {
            sessions.delete(sessionId);
        }
    }
}, 60 * 60 * 1000);

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Interner Serverfehler' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🎵 Spotify Backend Server läuft auf Port ${PORT}`);
    console.log(`🔗 Callback URL: http://localhost:${PORT}/callback`);
    console.log(`🌐 Frontend URL: http://localhost:${PORT}`);
    
    if (!SPOTIFY_CONFIG.clientId || !SPOTIFY_CONFIG.clientSecret) {
        console.warn('⚠️  WARNUNG: Spotify Client ID oder Client Secret nicht konfiguriert!');
        console.log('📝 Erstelle eine .env Datei mit:');
        console.log('   SPOTIFY_CLIENT_ID=deine_client_id');
        console.log('   SPOTIFY_CLIENT_SECRET=dein_client_secret');
    }
});

module.exports = app;