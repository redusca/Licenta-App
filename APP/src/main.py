from flask import Flask, jsonify
from flask_cors import CORS
import sys
import os
from config import config
from API.drive_routes import drive_bp
from API.tools_routes import tools_bp
from API.agent_routes import agent_bp

app = Flask(__name__)
CORS(app)  # Enable CORS for development

app.register_blueprint(drive_bp, url_prefix='/api/drive')
app.register_blueprint(tools_bp, url_prefix='/api/tools')
app.register_blueprint(agent_bp, url_prefix='/api/agent')

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "message": "Python backend is running"})

if __name__ == '__main__':
    print(f"Starting Flask server on {config.HOST}:{config.PORT}")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
