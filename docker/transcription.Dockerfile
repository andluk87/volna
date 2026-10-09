FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HF_HOME=/models/huggingface
WORKDIR /app
COPY docker/transcription-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt \
    && mkdir -p /models && useradd --system --uid 10001 --create-home whisper
COPY docker/transcription_service.py docker/transcription_runtime.py ./
COPY tests/transcription_runtime_test.py tests/transcription_http_test.py ./tests/
RUN python -m unittest discover -s tests -p 'transcription_*_test.py' \
    && chown -R whisper:whisper /app /models
USER whisper
EXPOSE 8000
CMD ["uvicorn", "transcription_service:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
