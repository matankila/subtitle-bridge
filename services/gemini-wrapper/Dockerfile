FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 GEMINI_COOKIE_PATH=/tmp/gemini-web
WORKDIR /app
COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip==26.2.2 \
    && python -m pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 app
COPY app.py .
USER app
EXPOSE 8080
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8080","--no-access-log"]
