import os
import base64
import io
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from PyPDF2 import PdfReader

app = Flask(__name__)
CORS(app)

# Configure Gemini API
API_KEY = "AIzaSyAr9_6hFw2eLhXkMyMiwWODgo0eJu-MKLk"
genai.configure(api_key=API_KEY)

# Use Gemini models
MODEL_NAME = "gemini-2.5-flash"
EMBEDDING_MODEL = "models/embedding-001"

try:
    model = genai.GenerativeModel(MODEL_NAME)
except Exception as e:
    print(f"Error initializing model {MODEL_NAME}: {e}")
    model = genai.GenerativeModel("gemini-1.5-flash")

# Simple In-Memory Vector Store for PDF Context
document_chunks = []
chunk_embeddings = []

def extract_text_from_pdf(pdf_bytes):
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"
    return text

def chunk_text(text, chunk_size=600, overlap=100):
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunks.append(text[i:i + chunk_size])
    return chunks

def dot_product(v1, v2):
    return sum(x * y for x, y in zip(v1, v2))

def norm(v):
    return sum(x**2 for x in v)**0.5

def cosine_similarity(v1, v2):
    try:
        return dot_product(v1, v2) / (norm(v1) * norm(v2))
    except ZeroDivisionError:
        return 0

@app.route('/api/upload-pdf', methods=['POST'])
def upload_pdf():
    global document_chunks, chunk_embeddings
    data = request.json
    pdf_base64 = data.get('pdf_base64', '')
    if not pdf_base64:
        return jsonify({"error": "No PDF provided"}), 400
    try:
        header, encoded = pdf_base64.split(",", 1)
        pdf_bytes = base64.b64decode(encoded)
        text = extract_text_from_pdf(pdf_bytes)
        new_chunks = chunk_text(text)
        document_chunks = new_chunks
        chunk_embeddings = []
        for chunk in new_chunks:
            embedding = genai.embed_content(model=EMBEDDING_MODEL, content=chunk, task_type="retrieval_document")["embedding"]
            chunk_embeddings.append(embedding)
        return jsonify({"message": f"Successfully indexed {len(new_chunks)} chunks."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    user_message = data.get('message', '')
    image_data = data.get('image', None)
    chat_history = data.get('chat_history', []) # Expecting list of {role, parts: [{text}]}
    
    try:
        # 1. RAG Context Retrieval
        context = ""
        if user_message and chunk_embeddings:
            query_embedding = genai.embed_content(model=EMBEDDING_MODEL, content=user_message, task_type="retrieval_query")["embedding"]
            similarities = [cosine_similarity(query_embedding, emb) for emb in chunk_embeddings]
            top_indices = sorted(range(len(similarities)), key=lambda i: similarities[i], reverse=True)[:3]
            context = "\n\n[PDF Context]:\n" + "\n---\n".join([document_chunks[i] for i in top_indices])

        # 2. Prepare Current Turn Content
        current_turn_parts = []
        if context:
            current_turn_parts.append({"text": f"Information from external document:\n{context}"})
        
        if user_message:
            current_turn_parts.append({"text": user_message})
            
        if image_data:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(";")[0].split(":")[1]
            image_bytes = base64.b64decode(encoded)
            current_turn_parts.append({"mime_type": mime_type, "data": image_bytes})

        # 3. Build Full Multi-turn Request
        # Gemini expects a list of turns alternating between user and model
        full_content = []
        for turn in chat_history:
            # Ensure parts is a list of dicts with 'text'
            full_content.append({
                "role": turn["role"],
                "parts": turn["parts"]
            })
        
        # Add the current turn
        full_content.append({
            "role": "user",
            "parts": current_turn_parts
        })
        
        # 4. Generate Response
        response = model.generate_content(full_content)
        return jsonify({"response": response.text})
    except Exception as e:
        print(f"Error calling Gemini: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
