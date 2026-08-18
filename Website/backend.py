import asyncio
import websockets
import serial
import json
import threading
import sys

# Configuration
SERIAL_PORT = '/dev/ttyUSB0'
BAUD_RATE = 115200
WS_HOST = "localhost"
WS_PORT = 8080

# Global state to hold connected WebSocket clients
connected_clients = set()
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

def serial_reader():
    """Background thread to read lines from the Serial port and broadcast them to WS clients."""
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"[SERIAL] Connected to {SERIAL_PORT} at {BAUD_RATE} baud.")
        
        while True:
            # readline() blocks until a newline or timeout, releasing the GIL
            # so the asyncio WebSocket loop can handle ping/pongs properly!
            line = ser.readline().decode('utf-8', errors='ignore').strip()
            if line:
                print(f"[RX] {line}")
                # If the line looks like JSON, broadcast it
                if line.startswith('{') and line.endswith('}'):
                    # Schedule broadcast on the asyncio event loop
                    if connected_clients:
                        asyncio.run_coroutine_threadsafe(broadcast(line), loop)
    except serial.SerialException as e:
        print(f"[ERROR] Could not open serial port {SERIAL_PORT}: {e}")
        print("Make sure the ESP32 is plugged in and the port is correct.")
        sys.exit(1)

async def broadcast(message):
    """Sends a message to all connected WebSocket clients."""
    if connected_clients:
        await asyncio.gather(*(client.send(message) for client in connected_clients))

async def handle_client(websocket):
    """Registers a new WebSocket client and keeps the connection open."""
    print(f"[WS] Client connected from {websocket.remote_address}")
    connected_clients.add(websocket)
    try:
        async for _ in websocket:
            pass # We only send data, don't expect to receive
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        print(f"[WS] Client disconnected")
        connected_clients.remove(websocket)

async def main():
    print(f"[WS] Starting WebSocket server on ws://{WS_HOST}:{WS_PORT}")
    
    # Start the serial reader in a background thread
    threading.Thread(target=serial_reader, daemon=True).start()
    
    # Start the WebSocket server
    async with websockets.serve(handle_client, WS_HOST, WS_PORT):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        loop.run_until_complete(main())
    except KeyboardInterrupt:
        print("\n[INFO] Shutting down backend.")
