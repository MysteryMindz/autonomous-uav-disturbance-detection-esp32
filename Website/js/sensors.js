/**
 * UAV Ground Station - Raw Sensor Stream Manager
 */

const MAX_ROWS = 100; // Prevent memory leak / DOM lag by capping rows
let isStreaming = true;
let streamInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    const pauseBtn = document.getElementById('pauseStreamBtn');
    const statusBadge = document.getElementById('streamStatus');
    
    pauseBtn.addEventListener('click', () => {
        isStreaming = !isStreaming;
        if (isStreaming) {
            pauseBtn.textContent = 'Pause Stream';
            pauseBtn.classList.remove('active');
            statusBadge.textContent = 'ACTIVE (10 Hz)';
            statusBadge.className = 'badge badge-green';
        } else {
            pauseBtn.textContent = 'Resume Stream';
            pauseBtn.classList.add('active');
            statusBadge.textContent = 'PAUSED';
            statusBadge.className = 'badge badge-warning';
        }
    });

    // We now use WebSocket (initSensorWebSocket is called via another DOMContentLoaded listener)
});

function formatXYZ(x, y, z) {
    return `
        <div class="data-xyz">
            <span class="data-x">${x.toFixed(2)}</span>
            <span class="data-y">${y.toFixed(2)}</span>
            <span class="data-z">${z.toFixed(2)}</span>
        </div>
    `;
}

function processSensorFrame(frame) {
    if (!isStreaming) return;

    const tbody = document.getElementById('sensorTableBody');
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td style="color: #4a5b78; text-align: left;">${frame.timestamp}</td>
        <td>${frame.tof_distance_mm}</td>
        <td>${formatXYZ(frame.accel.x, frame.accel.y, frame.accel.z)}</td>
        <td>${formatXYZ(frame.gyro.x, frame.gyro.y, frame.gyro.z)}</td>
        <td>${frame.pressure_hpa.toFixed(1)}</td>
        <td>${frame.temp_c.toFixed(1)}</td>
    `;

    // Prepend to show newest at the top
    tbody.insertBefore(tr, tbody.firstChild);

    // Keep row count manageable
    while (tbody.children.length > MAX_ROWS) {
        tbody.removeChild(tbody.lastChild);
    }
}

let ws;

function initSensorWebSocket() {
    ws = new WebSocket('ws://localhost:8080');

    ws.onmessage = (event) => {
        if (!isStreaming) return;
        try {
            const data = JSON.parse(event.data);
            
            // Format incoming data for processSensorFrame
            const frame = {
                timestamp: data.timestamp_ms || "0",
                tof_distance_mm: data.distance || 0,
                accel: {
                    x: data.ax !== undefined ? data.ax / 16384.0 : 0,
                    y: data.ay !== undefined ? data.ay / 16384.0 : 0,
                    z: data.az !== undefined ? data.az / 16384.0 : 0
                },
                gyro: {
                    x: data.gx !== undefined ? data.gx / 131.0 : 0,
                    y: data.gy !== undefined ? data.gy / 131.0 : 0,
                    z: data.gz !== undefined ? data.gz / 131.0 : 0
                },
                pressure_hpa: data.pressure || 0,
                temp_c: data.temp || 0
            };
            
            processSensorFrame(frame);
        } catch(e) {
            console.error("Failed to parse websocket message", e);
        }
    };

    ws.onclose = () => {
        setTimeout(initSensorWebSocket, 2000);
    };
}

// Start websocket when loaded
document.addEventListener('DOMContentLoaded', () => {
    initSensorWebSocket();
});
