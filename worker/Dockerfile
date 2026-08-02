FROM python:3.12-slim

WORKDIR /app

# Install arduino-cli from local tarball (avoids network issues during build)
COPY worker/arduino-cli.tar.gz /tmp/
RUN tar -xzf /tmp/arduino-cli.tar.gz -C /usr/local/bin arduino-cli && \
    rm /tmp/arduino-cli.tar.gz && \
    chmod +x /usr/local/bin/arduino-cli

# Install Arduino AVR core + required libraries
RUN arduino-cli core update-index && \
    arduino-cli core install arduino:avr && \
    arduino-cli lib install \
      "DHT sensor library" \
      "Adafruit Unified Sensor" \
      "LiquidCrystal I2C" \
      "Adafruit SSD1306" \
      "Adafruit GFX Library" \
      "Adafruit NeoPixel" \
      "Adafruit BMP280 Library" \
      "MFRC522" \
      "Keypad" \
      "NewPing" \
      "Servo"

# Copy worker package
COPY worker/pyproject.toml .
COPY worker/src/ src/

RUN pip install --no-cache-dir .

# Copy catalog
COPY catalog/ /app/catalog/

ENV CATALOG_DIR=/app/catalog/components
ENV PLATFORM_CATALOG_DIR=/app/catalog/platforms

CMD ["python", "-m", "mcu_worker.main"]
