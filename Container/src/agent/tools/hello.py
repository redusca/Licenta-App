"""
DEPRECATED — this file is no longer used.

The hello tool implementation has moved to APP/src/tools/hello.py.

The container is a pure LLM reasoning layer; all tool code lives in the APP.
The agent receives tool definitions at /api/agent/init and calls back to the
APP's /api/tools/execute endpoint when the LLM invokes a tool.
"""
