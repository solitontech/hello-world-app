// MSAL Configuration
const msalConfig = {
    auth: {
        // You'll need to replace this with your actual Microsoft Entra (Azure AD) Client ID
        clientId: "3550e79f-e2b6-4030-a06d-2c73a79ded9d",
        authority: "https://login.microsoftonline.com/06ed72e8-a419-4795-9eb3-5512cf1d3d98",
        redirectUri: window.location.href, // Redirects back to the app
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
    alert("MSAL Instantiation Error: " + error.message);
}

document.addEventListener('DOMContentLoaded', async () => {
    const card = document.getElementById('main-card');
    const authBtn = document.getElementById('auth-btn');
    const welcomeMessage = document.getElementById('welcome-message');

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
        alert("MSAL Start Error: " + error.message);
    }

    // Login/Logout Button Click Handler
    authBtn.addEventListener('click', async () => {
        if (!msalInstance) {
            alert("⚠️ Setup Error: MSAL did not initialize properly. Check if the MSAL script is blocked or failing to load.");
            return;
        }

        const currentAccounts = msalInstance.getAllAccounts();

        if (currentAccounts.length > 0) {
            // Logout
            try {
                await msalInstance.logoutRedirect({
                    postLogoutRedirectUri: window.location.href
                });
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
                alert("Login Error: " + error.message);
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
