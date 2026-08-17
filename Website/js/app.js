/**
 * UAV Ground Station Dashboard Logic
 */

// 1. Modular JSON State Object
let dashboardState = {
    timestamp_ms: "0",
    system_status: "ONLINE",
    threat_level: "CLEAR",

    derived_metrics: {
        altitude_change_ms: "0.0"
    },

    rae_messages: {
        issue: "No active threats detected. System operating nominally.",
        decision: "MAINTAIN CRUISE VECTOR"
    },

    risk_scores: {
        r_total: "0.0",
        d_tof: "0.0",
        d_ir_left: "0.0",
        d_ir_right: "0.0",
        a_turb: "0.0",
        v_cam: "0.0",
        s_loss: "0.0"
    },

    actuation: {
        servo_yaw_deg: "0",
        servo_pitch_deg: "0",
        maneuver_state: "CRUISE"
    },

    raw_sensors: {
        tof_distance_mm: "4500",
        pressure_hpa: "1012.5",
        temp_c: "24.3",
        accel_g: { ax: "0.0", ay: "0.0", az: "1.0" },
        gyro_dps: { gx: "0.0", gy: "0.0", gz: "0.0" }
    },

    diagnostics: {
        dominant_threat: "NONE",
        cam_clear_sector: "CENTER",
        rf_jamming_detected: "false",
        override_active: "false"
    }
};

/**
 * Translates raw hardware states into human-readable text alerts
 * and derives synthetic metrics (like altitude change) from raw sensors
 */
let lastAltitude = null;
let lastTimestamp = null;

function deriveFrontendMetrics(data) {
    // 1. RAE Messages
    if (data.diagnostics && data.actuation) {
        let issue = "No active threats detected. System operating nominally.";
        let decision = "MAINTAIN CRUISE VECTOR";

        if (data.system_status !== "ONLINE" || data.threat_level !== "CLEAR") {
            const threat = data.diagnostics.dominant_threat;

            if (threat === "RF_JAMMER") issue = "CRITICAL: High-intensity RF Jamming detected.";
            else if (threat === "OBSTACLE_FRONT") issue = "WARNING: Frontal collision imminent.";
            else if (threat === "SIDE_PROXIMITY") issue = "WARNING: Lateral obstacle detected.";
            else if (threat === "TURBULENCE") issue = "ADVISORY: Severe turbulence encountered.";
            else if (threat === "LOW_VISIBILITY") issue = "ADVISORY: Vision system degraded.";
            else issue = `ALERT: Unknown threat class (${threat}).`;

            const maneuver = data.actuation.maneuver_state;
            decision = `EVASIVE ACTION: ${maneuver.replace(/_/g, ' ')} INITIATED.`;
        }

        // Inject these back into the data object for the UI binder
        data.rae_messages = { issue, decision };
    }

    // 2. Altitude Change (derived from barometric pressure)
    if (data.raw_sensors && data.raw_sensors.pressure_hpa && data.timestamp_ms !== undefined) {
        const p = parseFloat(data.raw_sensors.pressure_hpa);
        const currentAltitude = 44330 * (1 - Math.pow(p / 1013.25, 0.1903));
        const currentTime = parseInt(data.timestamp_ms);

        let altChangeStr = "0.0";

        if (lastAltitude !== null && lastTimestamp !== null && currentTime > lastTimestamp) {
            const dt_s = (currentTime - lastTimestamp) / 1000.0;
            const dAlt = currentAltitude - lastAltitude;
            const rate = dAlt / dt_s;
            altChangeStr = rate > 0 ? `+${rate.toFixed(1)}` : rate.toFixed(1);
        }

        lastAltitude = currentAltitude;
        lastTimestamp = currentTime;

        data.derived_metrics = { altitude_change_ms: altChangeStr };
    }
}

/**
 * Updates the 3D CSS transform of the UAV model icon in the header
 */
function updateUAVVisualizer(data) {
    if (!data.actuation) return;

    const yaw = parseFloat(data.actuation.servo_yaw_deg) || 0;
    const pitch = parseFloat(data.actuation.servo_pitch_deg) || 0;
    const isAlert = data.actuation.maneuver_state !== 'CRUISE';
    
    // Delegate to native Three.js WebGL renderer
    if (window.update3DModel) {
        window.update3DModel(yaw, pitch, isAlert);
    }
}

/**
 * 2. Dynamic Rendering Function
 * Recursively maps JSON keys to HTML elements via data-bind attributes.
 * Adding new sensors only requires adding a matching HTML element with data-bind="category.key".
 */
function updateDashboard(data, prefix = '') {
    // If this is the root object update, generate our synthetic UI metrics first
    if (prefix === '') {
        deriveFrontendMetrics(data);
        updateUAVVisualizer(data);
    }

    for (const key in data) {
        if (data.hasOwnProperty(key)) {
            const value = data[key];
            const fullKey = prefix ? `${prefix}.${key}` : key;

            if (typeof value === 'object' && value !== null) {
                updateDashboard(value, fullKey);
            } else {
                const elements = document.querySelectorAll(`[data-bind="${fullKey}"]`);
                elements.forEach(el => {
                    el.innerText = value;
                    applyDynamicColors(el, value, fullKey);
                });
            }
        }
    }
    updateSystemStatus();
}

/**
 * Applies color classes based on string matching or numeric thresholds
 */
function applyDynamicColors(element, value, key) {
    element.classList.remove('text-nominal', 'text-alert', 'text-warning');
    const valString = String(value).toUpperCase();

    // String-based rules
    if (valString.includes('ATTACK') || valString.includes('BLOCKED') || valString.includes('REROUTE')) {
        element.classList.add('text-alert');
    } else if (valString.includes('NOMINAL') || valString.includes('CLEAR') || valString.includes('GOOD')) {
        element.classList.add('text-nominal');
    }

    // Numeric-based rules for specific fields
    if (key === 'decisionEngine.riskScore') {
        const num = parseFloat(value);
        if (num > 75) element.classList.add('text-alert');
        else if (num > 40) element.classList.add('text-warning');
        else element.classList.add('text-nominal');
    }
}

/**
 * Updates the global system header status depending on the decision engine's actuation state
 */
function updateSystemStatus() {
    const statusText = document.querySelector('.system-status');

    if (dashboardState.system_status !== 'ONLINE' || dashboardState.threat_level !== 'CLEAR') {
        statusText.innerHTML = `<span class="status-indicator" style="background-color: var(--accent-red); box-shadow: 0 0 10px var(--accent-red);"></span> SYSTEM ${dashboardState.system_status} - ${dashboardState.threat_level}`;
        statusText.style.color = 'var(--accent-red)';
    } else {
        statusText.innerHTML = `<span class="status-indicator"></span> SYSTEM ${dashboardState.system_status}`;
        statusText.style.color = 'var(--accent-green)';
    }
}

/**
 * 3. Log Handling
 * Appends log messages to the UI terminal, keeping only the most recent MAX_LOGS.
 */
const MAX_LOGS = 50;
const logTerminal = document.getElementById('log-terminal');

function appendLog(message, type = 'info') {
    if (!logTerminal) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

    entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> <span class="log-content">${message}</span>`;
    logTerminal.appendChild(entry);

    // Prevent memory bloat by maintaining only the last 50 logs
    while (logTerminal.children.length > MAX_LOGS) {
        logTerminal.removeChild(logTerminal.firstChild);
    }

    // Auto-scroll
    logTerminal.scrollTop = logTerminal.scrollHeight;
}

// Initial Render and setup simulated data feed
document.addEventListener('DOMContentLoaded', () => {
    updateDashboard(dashboardState);
    appendLog('System initialization sequence started...', 'info');
    appendLog('Telemetry link established on COM4', 'nominal');
    appendLog('Decision engine armed and monitoring', 'nominal');

    // Debug Controls Logic
    const manualOverride = document.getElementById('debug-manual-override');
    const debugYaw = document.getElementById('debug-yaw');
    const debugPitch = document.getElementById('debug-pitch');
    const debugAlert = document.getElementById('debug-alert');
    const debugYawVal = document.getElementById('debug-yaw-val');
    const debugPitchVal = document.getElementById('debug-pitch-val');

    function applyManualControls() {
        if (manualOverride && manualOverride.checked && window.update3DModel) {
            const yaw = parseInt(debugYaw.value);
            const pitch = parseInt(debugPitch.value);
            const isAlert = debugAlert.checked;
            
            debugYawVal.textContent = yaw;
            debugPitchVal.textContent = pitch;
            
            window.update3DModel(yaw, pitch, isAlert);
        }
    }

    if (debugYaw) {
        debugYaw.addEventListener('input', applyManualControls);
        debugPitch.addEventListener('input', applyManualControls);
        debugAlert.addEventListener('change', applyManualControls);
        
        manualOverride.addEventListener('change', () => {
            if (!manualOverride.checked) {
                // Restore automatic simulation state when unchecked
                updateDashboard(dashboardState);
            } else {
                applyManualControls();
            }
        });
    }

    // Simulate incoming telemetry changes for demonstration
    setInterval(simulateTelemetry, 1500);
});

/**
 * Simulation of varying data and events over time.
 */
function simulateTelemetry() {
    if (document.getElementById('debug-manual-override')?.checked) return;

    // Increment timestamp by 1.5s
    dashboardState.timestamp_ms = (parseInt(dashboardState.timestamp_ms) + 1500).toString();

    // Randomize raw sensors a bit
    dashboardState.raw_sensors.pressure_hpa = (1012 + (Math.random() * 2 - 1)).toFixed(1);
    dashboardState.raw_sensors.temp_c = (24 + Math.random()).toFixed(1);
    dashboardState.raw_sensors.accel_g.ax = (Math.random() * 0.1 - 0.05).toFixed(2);
    dashboardState.raw_sensors.gyro_dps.gz = (Math.random() * 2 - 1).toFixed(1);

    const rand = Math.random();

    // Trigger random simulated attack event
    if (rand > 0.95 && dashboardState.system_status === "ONLINE") {
        dashboardState.system_status = "EVASIVE";
        dashboardState.threat_level = "CRITICAL";
        dashboardState.risk_scores.r_total = "0.85";
        dashboardState.risk_scores.s_loss = "0.9";
        dashboardState.actuation.servo_yaw_deg = "-45";
        dashboardState.actuation.servo_pitch_deg = "25";
        dashboardState.actuation.maneuver_state = "EVASIVE_LEFT";
        dashboardState.diagnostics.dominant_threat = "RF_JAMMER";
        dashboardState.diagnostics.rf_jamming_detected = "true";

        appendLog('CRITICAL: RF Jamming Attack Detected!', 'alert');
        appendLog('Actuation triggered: EVASIVE_LEFT', 'warn');
    }
    // Clear attack event after a while
    else if (rand < 0.15 && dashboardState.system_status !== "ONLINE") {
        dashboardState.system_status = "ONLINE";
        dashboardState.threat_level = "CLEAR";
        dashboardState.risk_scores.r_total = "0.1";
        dashboardState.risk_scores.s_loss = "0.0";
        dashboardState.actuation.servo_yaw_deg = "0";
        dashboardState.actuation.servo_pitch_deg = "0";
        dashboardState.actuation.maneuver_state = "CRUISE";
        dashboardState.diagnostics.dominant_threat = "NONE";
        dashboardState.diagnostics.rf_jamming_detected = "false";

        appendLog('Threat cleared. Resuming nominal flight path.', 'nominal');
    }

    updateDashboard(dashboardState);
}
