document.addEventListener('DOMContentLoaded', () => {
    const card = document.getElementById('main-card');
    const button = document.getElementById('explore-btn');

    // Subtle parallax effect on card move
    document.addEventListener('mousemove', (e) => {
        const xAxis = (window.innerWidth / 2 - e.pageX) / 45;
        const yAxis = (window.innerHeight / 2 - e.pageY) / 45;
        card.style.transform = `rotateY(${xAxis}deg) rotateX(${yAxis}deg) translateY(-8px)`;
    });

    // Reset rotation when mouse leaves window
    document.addEventListener('mouseleave', () => {
        card.style.transform = `rotateY(0deg) rotateX(0deg) translateY(0)`;
    });

    // Click effect for the button
    button.addEventListener('click', () => {
        button.innerText = "Welcome!";
        button.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
        button.style.boxShadow = "0 20px 25px -5px rgba(16, 185, 129, 0.4)";
        
        // Add a small celebration effect
        createParticles(button);
    });

    function createParticles(element) {
        // Simple visual feedback could go here
        console.log("Welcome animation triggered");
    }
});
