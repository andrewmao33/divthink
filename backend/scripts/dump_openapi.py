"""Prints the API's schema as JSON, for the frontend's generated types.

Run from backend/ via the frontend's `npm run gen:types`.
"""
import json

from app.main import app

print(json.dumps(app.openapi(), indent=2))
