#pragma once
// Copy to config.local.h (ignored by Git). Never commit Wi-Fi or device credentials.
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define API_BASE_URL "https://YOUR_MAC_LAN_IP:3443"
#define DEVICE_ID "locker-001"
#define LOCKER_ID "REPLACE_WITH_DATABASE_LOCKER_UUID"
#define DEVICE_TOKEN ""
// Paste the local CA PEM; the server certificate must match the API hostname/IP.
#define API_CA_PEM ""
// Remain disabled until pulse duration, wiring, reset behavior and duty cycle are validated.
#define ACTUATION_ENABLED false
#define MAX_PULSE_MS 5000
#ifndef OTA_ENABLED
#define OTA_ENABLED false
#endif
#define OTA_MAX_IMAGE_BYTES 1310720
