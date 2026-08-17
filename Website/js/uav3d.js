let scene, camera, renderer, planeGroup, planeMaterial;

function init3D() {
    const container = document.getElementById('uav-3d-canvas');
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    // Position camera above and slightly behind to give a top-down isometric view
    camera.position.set(0, 15, 12);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // Fixed-Wing Airplane Geometry
    planeGroup = new THREE.Group();

    // Main material
    planeMaterial = new THREE.MeshPhongMaterial({
        color: 0x93c5fd, // Soft pastel blue
        flatShading: true
    });

    const darkMaterial = new THREE.MeshPhongMaterial({
        color: 0x1e1e1e // Soft dark grey for cockpit
    });

    // Fuselage (Body)
    const fuselageGeo = new THREE.BoxGeometry(1.5, 1.5, 8);
    const fuselage = new THREE.Mesh(fuselageGeo, planeMaterial);
    planeGroup.add(fuselage);

    // Main Wing
    const wingGeo = new THREE.BoxGeometry(10, 0.3, 2);
    const wing = new THREE.Mesh(wingGeo, planeMaterial);
    wing.position.set(0, 0.2, -1);
    planeGroup.add(wing);

    // Tail Wing (Horizontal Stabilizer)
    const tailWingGeo = new THREE.BoxGeometry(4, 0.2, 1.5);
    const tailWing = new THREE.Mesh(tailWingGeo, planeMaterial);
    tailWing.position.set(0, 0.2, 3.5);
    planeGroup.add(tailWing);

    // Vertical Stabilizer (Tail Fin)
    const vertStabGeo = new THREE.BoxGeometry(0.3, 2, 1.5);
    const vertStab = new THREE.Mesh(vertStabGeo, planeMaterial);
    vertStab.position.set(0, 1.2, 3.5);
    planeGroup.add(vertStab);

    // Cockpit Canopy
    const cockpitGeo = new THREE.BoxGeometry(1, 0.8, 2);
    const cockpit = new THREE.Mesh(cockpitGeo, darkMaterial);
    cockpit.position.set(0, 1, -1.5);
    planeGroup.add(cockpit);

    scene.add(planeGroup);

    // Start render loop
    animate();
}

let targetYaw = 0;
let targetPitch = 0;
let currentYaw = 0;
let currentPitch = 0;
let currentRoll = 0;

function animate() {
    requestAnimationFrame(animate);

    if (planeGroup) {
        // Smooth interpolation (LERP) - reduced factor for slower movement
        currentYaw += (targetYaw - currentYaw) * 0.03;
        currentPitch += (targetPitch - currentPitch) * 0.03;

        planeGroup.rotation.order = 'YXZ';
        planeGroup.rotation.y = currentYaw;
        planeGroup.rotation.x = currentPitch;
        planeGroup.rotation.z = 0; // Removed banking (roll) to keep the horizon flat
    }

    renderer.render(scene, camera);
}

// Global update function called by app.js
window.update3DModel = function (yawDeg, pitchDeg, isAlert) {
    if (!planeGroup) return;

    // Convert degrees to radians
    targetYaw = THREE.MathUtils.degToRad(-yawDeg);
    targetPitch = THREE.MathUtils.degToRad(-pitchDeg);

    // Color alert handling (Red for evasive action)
    if (isAlert) {
        planeMaterial.color.setHex(0xfca5a5); // Pastel red
    } else {
        planeMaterial.color.setHex(0x93c5fd); // Pastel blue
    }
}

// Handle resizing
window.addEventListener('resize', () => {
    const container = document.getElementById('uav-3d-canvas');
    if (!container || !camera || !renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});

// Initialize after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    // Small timeout to ensure container is fully sized by CSS grid/flex
    setTimeout(init3D, 100);
});
