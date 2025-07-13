# Show your viewers what you're listening to

## Installation Guide

### 1. Download and extract
1.1 Download the ZIP file  
1.2 Unzip the file to any folder

---

### 2. Set up your Spotify App
2.1 Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/create) *(make sure you're logged in)*  
2.2 Click **"Create an App"**  
2.3 Enter a name and description for your app  
2.4 Add the following **Redirect URIs**:

```
http://127.0.0.1:8080/callback
http://127.0.0.1:8080/auth/spotify
```

2.5 Click **"Save"**

---

### 3. Configure your credentials

3.1 Open your newly created app in the Spotify dashboard  
3.2 Copy your **Client ID** and **Client Secret**  
3.3 Open the `.env` file inside the overlay folder in any text editor  
3.4 Replace `YOUR_CLIENT_ID` and `YOUR_CLIENT_SECRET` with the actual values  
3.5 Save the file

---

### 4. Start the overlay

4.1 Open a terminal in the overlay folder  
4.2 Run the following commands:

```bash
npm install
node server.js
```

4.3 Open [http://127.0.0.1:8080](http://127.0.0.1:8080) in your browser  
4.4 Paste your Client ID and Client Secret again and click **"Connect to Spotify"**  
4.5 Click **"Save Settings"**  
4.6 Copy the URL and add it to OBS as a **Browser Source** and as a **Dock**

---

### 5. OBS Setup

5.1 Open the Dock  
5.2 Paste your Client ID and Client Secret again and click **"Connect to Spotify"**  
5.3 Reload the Browser Source  

---

### You're done!
Start playing music on Spotify the overlay will update in real-time.

If there is any problem just open an [Issue](https://github.com/derfuxde/obs-spotifyoverlay/issues/new)
