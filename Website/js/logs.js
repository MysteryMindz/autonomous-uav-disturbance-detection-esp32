/**
 * UAV Ground Station - Event Logs Manager
 */

// 1. Easy-to-edit configuration
// Modify this array to easily change or add new event types based on hardware needs
const EVENT_TYPES = [
    { id: 'ALL', label: 'All Types', color: 'var(--text-muted)' },
    { id: 'SYSTEM', label: 'System Event', color: 'var(--text-muted)' },
    { id: 'RF_DEGRADATION', label: 'RF Degradation', color: 'var(--accent-warning)' },
    { id: 'OBSTACLE', label: 'Obstacle Detected', color: 'var(--accent-red)' },
    { id: 'VISION_ALERT', label: 'Vision Alert', color: 'var(--accent-red)' },
    { id: 'ACTUATION', label: 'Actuation', color: 'var(--accent-blue)' },
    { id: 'THREAT_CLEARED', label: 'Threat Cleared', color: 'var(--accent-green)' }
];

// Mock data array to store logs
// In production, you can append objects directly to this array when hardware data arrives
let eventLogsData = [
    { timestamp: "15:20:10.123", type: "SYSTEM", source: "System", message: "System initialization sequence started..." },
    { timestamp: "15:20:11.450", type: "SYSTEM", source: "Comms", message: "Telemetry link established on COM4" },
    { timestamp: "15:24:32.110", type: "RF_DEGRADATION", source: "RF_ESP32", message: "CRITICAL: High packet loss detected!" },
    { timestamp: "15:24:32.150", type: "ACTUATION", source: "Actuation", message: "Actuation triggered: REROUTE LEFT 45°" },
    { timestamp: "15:26:40.000", type: "OBSTACLE", source: "Proximity", message: "Side intrusion blocked - distance < 1m" },
    { timestamp: "15:27:10.000", type: "THREAT_CLEARED", source: "DecisionEngine", message: "Threats cleared. Resuming nominal flight path." }
];

/**
 * 2. Add Event Log Function
 * Simple function to push a new log directly from your hardware stream
 */
function addEventLog(type, source, message) {
    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    
    eventLogsData.push({ timestamp, type, source, message });
    renderTable(); // Re-render table when new data arrives
}

// 3. UI logic
let currentFilter = 'ALL';

document.addEventListener('DOMContentLoaded', () => {
    populateFilters();
    renderTable();
    
    // Event listener for CSV Export
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
});

function populateFilters() {
    const filterContainer = document.getElementById('typeFilter');
    filterContainer.innerHTML = ''; // Clear existing
    
    EVENT_TYPES.forEach(t => {
        const btn = document.createElement('button');
        btn.className = `filter-pill ${t.id === currentFilter ? 'active' : ''}`;
        btn.textContent = t.label;
        btn.style.borderColor = t.color;
        
        btn.addEventListener('click', () => {
            // Update state
            currentFilter = t.id;
            
            // Update active styling
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            
            // Re-render table
            renderTable();
        });
        
        filterContainer.appendChild(btn);
    });
}

function renderTable() {
    const tbody = document.getElementById('logsTableBody');
    const filterValue = currentFilter;
    
    tbody.innerHTML = '';
    
    // Apply filter
    const filteredLogs = eventLogsData.filter(log => {
        if (filterValue === 'ALL') return true;
        return log.type === filterValue;
    });

    // Render backwards to show newest first
    for (let i = filteredLogs.length - 1; i >= 0; i--) {
        const log = filteredLogs[i];
        
        // Find color config
        const typeConfig = EVENT_TYPES.find(t => t.id === log.type) || { color: 'var(--text-bright)' };
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="color: #4a5b78;">${log.timestamp}</td>
            <td><span class="type-badge" style="color: ${typeConfig.color}; border: 1px solid ${typeConfig.color};">${log.type}</span></td>
            <td>${log.source}</td>
            <td>${log.message}</td>
        `;
        tbody.appendChild(tr);
    }
}

/**
 * 4. Export to CSV Function
 */
function exportToCSV() {
    if (eventLogsData.length === 0) {
        alert("No logs to export.");
        return;
    }
    
    // Headers
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Timestamp,Type,Source,Message\n";
    
    // Data rows
    eventLogsData.forEach(row => {
        // Escape quotes and commas
        const safeMessage = `"${row.message.replace(/"/g, '""')}"`;
        const safeSource = `"${row.source.replace(/"/g, '""')}"`;
        csvContent += `${row.timestamp},${row.type},${safeSource},${safeMessage}\n`;
    });
    
    // Create a hidden link and trigger download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    link.setAttribute("download", `uav_event_logs_${dateStr}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
