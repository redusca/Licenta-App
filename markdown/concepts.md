# Application Concepts & Technologies for Research

This document outlines the key technical concepts, architectural decisions, and technologies used in the development of the Licenta App. It serves as a guide for understanding the underlying systems.

## 1. System Architecture: "The Electron-Python Bridge"

The application uses a hybrid architecture acting as a desktop application while leveraging web technologies for the UI and Python for system-level operations.

*   **Electron (Main Process)**: Acts as the native wrapper, managing the application window, system tray, and native OS dialogs. It handles the lifecycle of the application.
*   **React (Renderer Process)**: Provides the user interface. It is a standard Single Page Application (SPA) served similarly to a website but running locally.
*   **Python (Background Service)**: Runs as a child process of the Electron application. It serves a REST API (Flask) that the React frontend consumes. This allows the app to use Python's powerful system manipulation libraries which are not available in a browser environment.
*   **IPC (Inter-Process Communication)**: Code in the `preload.ts` script uses the `contextBridge` to securely expose specific Electron capabilities (like native file pickers) to the React frontend.

## 2. Operating System Integration (Windows)

### Virtual Drive Abstraction
The application implements a "Virtual Drive" concept not by mounting a filesystem driver, but by creating a managed directory structure.
*   **Shortcut Mode**: Uses Windows `.lnk` (Shell Links) to create references to files without moving them. This requires interaction with the Windows Shell Interface (often via `WScript.Shell` or COM objects).
*   **Move Mode**: Physical file organization managed by the application.

### MFT (Master File Table) Scanning
*   **Concept**: Instead of traversing the directory tree recursively (which is slow for millions of files), the app accesses the NTFS Master File Table directly.
*   **Technology**: Uses `ctypes` in Python to interface with the Windows API (`kernel32.dll`) to read raw disk structures. This provides near-instant search capabilities across the entire drive.
*   **Implementation**: Requires Administrative privileges to read raw volume data.

### Native Execution
*   **Files**: Uses `os.startfile` (on Windows) to delegate file opening to the operating system's default associated application.
*   **Dialogs**: Uses Electron's `dialog.showOpenDialog` to invoke the native Windows Explorer file picker, providing a familiar UX.

## 3. Frontend Technologies & Patterns

*   **React & TypeScript**: Uses a component-based architecture with static typing for robustness.
*   **Tailwind CSS**: A utility-first CSS framework used for rapid UI development and ensuring consistent theming (Dark/Light mode).
*   **Vite**: The build tool used for extremely fast Hot Module Replacement (HMR) during development.
*   **React Context API**: Used for global state management, specifically for the Theme Context (toggling dark/light mode across the app).

## 4. Backend Technologies (Python)

*   **Flask**: A lightweight WSGI web application framework. It provides the API endpoints (`/api/drive/...`) that the frontend calls.
*   **CORS (Cross-Origin Resource Sharing)**: Configured to allow the local React application (running on a different port/protocol) to communicate with the local Python server.
*   **File System Operations**: Heavy use of `os` and `shutil` libraries for file manipulation (move, delete, copy, rename).

## 5. Security Concepts

*   **Context Isolation**: Electron is configured with `contextIsolation: true` to prevent the web page from accessing Node.js internals directly.
*   **Preaddir**: A specific script (`preload.ts`) is used to bridge only necessary functions to the window object, maintaining a security boundary.
*   **Localhost Binding**: The Python server is bound to `127.0.0.1` to ensure it only accepts connections from the local machine, not the network.

## 6. Docker & Containerization (Found in project structure)

*   The project structure suggests support for containerized environments (`docker/` folders), likely for isolatable backend logic or deployment scenarios, though the primary mode is desktop.

## 7. Algorithms

*   **Recursive Traversal**: Used in standard file listing logic where MFT is not applied.
*   **Breadcrumb Navigation**: Path parsing logic to split absolute paths into navigable segments.
*   **Search Filtering**: Real-time filtering of file lists based on string matching.
