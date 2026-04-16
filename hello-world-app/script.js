// MSAL Configuration
const msalConfig = {
    auth: {
        clientId: "3550e79f-e2b6-4030-a06d-2c73a79ded9d",
        authority: "https://login.microsoftonline.com/06ed72e8-a419-4795-9eb3-5512cf1d3d98",
        // Use origin only — query params / hash in href cause Azure AD redirect URI mismatch
        redirectUri: window.location.origin,
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
    }
};

// Create MSAL application instance
let msalInstance;
try {
    msalInstance = new msal.PublicClientApplication(msalConfig);
} catch (error) {
    console.error("MSAL Setup Error:", error);
}

document.addEventListener('DOMContentLoaded', async () => {
    const card = document.getElementById('main-card');
    const authBtn = document.getElementById('auth-btn');
    const welcomeMessage = document.getElementById('welcome-message');
    const errorEl = document.getElementById('error-message');

    function showError(msg) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
    }

    // Subtle parallax effect on card move
    document.addEventListener('mousemove', (e) => {
        const xAxis = (window.innerWidth / 2 - e.pageX) / 45;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 45;
        card.style.transform = `rotateY(${xAxis}deg) rotateX(${yAxis}deg) translateY(-8px)`;
    });

    document.addEventListener('mouseleave', () => {
        card.style.transform = `rotateY(0deg) rotateX(0deg) translateY(0)`;
    });

    // Check if user is already logged in
    try {
        if (!msalInstance) throw new Error("MSAL is not initialized properly. Check Client ID.");
        await msalInstance.initialize();
        // Handle redirect promise if using redirect flow
        const response = await msalInstance.handleRedirectPromise();

        if (response) {
            handleLoggedInUser(response.account);
        } else {
            const currentAccounts = msalInstance.getAllAccounts();
            if (currentAccounts.length > 0) {
                handleLoggedInUser(currentAccounts[0]);
            }
        }
    } catch (error) {
        console.error("Auth init error:", error);
        showError(error.message);
    }

    // Login/Logout Button Click Handler
    authBtn.addEventListener('click', async () => {
        if (!msalInstance) {
            showError("MSAL did not initialize. Check if the script is being blocked.");
            return;
        }

        const currentAccounts = msalInstance.getAllAccounts();

        if (currentAccounts.length > 0) {
            // Logout — use popup to match the popup login flow
            try {
                await msalInstance.logoutPopup({
                    postLogoutRedirectUri: window.location.origin
                });
                // Reset UI after popup closes
                welcomeMessage.textContent = "Sign in with Microsoft to experience the future of minimalist design.";
                authBtn.innerHTML = `
                    <svg class="ms-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><path fill="#f35325" d="M1 1h9v9H1z"/><path fill="#81bc06" d="M11 1h9v9h-9z"/><path fill="#05a6f0" d="M1 11h9v9H1z"/><path fill="#ffba08" d="M11 11h9v9h-9z"/></svg>
                    Sign in with Microsoft
                `;
                authBtn.style.background = "";
                authBtn.style.boxShadow = "";
            } catch (error) {
                console.error("Logout failed:", error);
            }
        } else {
            // Login
            try {
                const loginRequest = {
                    scopes: ["User.Read"]
                };

                // Using popup for a smoother experience on static sites
                const loginResponse = await msalInstance.loginPopup(loginRequest);
                if (loginResponse) {
                    handleLoggedInUser(loginResponse.account);
                }
            } catch (error) {
                console.error("Login failed:", error);
                // User_cancelled is not a real error — user just closed the popup
                if (error.errorCode !== "user_cancelled") {
                    showError(error.message);
                }
            }
        }
    });

    function handleLoggedInUser(account) {
        // Update UI for logged-in state
        const name = account.name || account.username || "Arjun";
        welcomeMessage.innerHTML = `Welcome back, <strong>${name}</strong>!<br>You have successfully signed in via Microsoft SSO.`;

        // Change button to Logout
        authBtn.innerHTML = `
            <svg class="ms-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Sign Out
        `;
        authBtn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
        authBtn.style.boxShadow = "0 10px 15px -3px rgba(239, 68, 68, 0.4)";
    }
});
