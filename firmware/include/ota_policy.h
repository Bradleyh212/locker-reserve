#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

#include "version.h"

#ifndef OTA_MAX_IMAGE_BYTES
#define OTA_MAX_IMAGE_BYTES 1310720
#endif

namespace locker {

constexpr std::uint32_t OTA_HEALTH_TIMEOUT_MS = 60000;

struct OtaContext {
  bool outputActive;
  bool pendingCommandReport;
  bool storageReady;
  bool wifiConnected;
  bool timeSynced;
  std::int64_t trustedTimeMs;
};

struct FirmwareManifest {
  std::uint32_t protocolVersion;
  const char* updateId;
  const char* version;
  std::uint32_t buildNumber;
  std::uint32_t sizeBytes;
  const char* sha256;
  std::int64_t expiresAtMs;
};

enum class ManifestReason {
  None,
  Busy,
  TimeUnsynced,
  BadProtocol,
  BadUpdateId,
  BadVersion,
  NotNewer,
  InvalidSize,
  TooLarge,
  BadHashFormat,
  Expired,
};

struct ManifestValidation {
  bool valid;
  ManifestReason reason;
};

inline bool mayStart(const OtaContext& context) {
  return !context.outputActive && !context.pendingCommandReport &&
         context.storageReady && context.wifiConnected && context.timeSynced;
}

inline const char* reasonCode(ManifestReason reason) {
  switch (reason) {
    case ManifestReason::None: return "OK";
    case ManifestReason::Busy: return "BUSY";
    case ManifestReason::TimeUnsynced: return "TIME_UNSYNCED";
    case ManifestReason::BadProtocol: return "BAD_PROTOCOL";
    case ManifestReason::BadUpdateId: return "BAD_UPDATE_ID";
    case ManifestReason::BadVersion: return "BAD_VERSION";
    case ManifestReason::NotNewer: return "NOT_NEWER";
    case ManifestReason::InvalidSize: return "INVALID_SIZE";
    case ManifestReason::TooLarge: return "TOO_LARGE";
    case ManifestReason::BadHashFormat: return "BAD_HASH_FORMAT";
    case ManifestReason::Expired: return "EXPIRED";
  }
  return "INVALID";
}

inline bool isUuid(const char* value) {
  if (!value || std::strlen(value) != 36) return false;
  for (std::size_t i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (value[i] != '-') return false;
    } else if (!((value[i] >= '0' && value[i] <= '9') ||
                 (value[i] >= 'a' && value[i] <= 'f') ||
                 (value[i] >= 'A' && value[i] <= 'F'))) {
      return false;
    }
  }
  return true;
}

inline bool isLowercaseSha256(const char* value) {
  if (!value || std::strlen(value) != 64) return false;
  for (std::size_t i = 0; i < 64; ++i) {
    if (!((value[i] >= '0' && value[i] <= '9') ||
          (value[i] >= 'a' && value[i] <= 'f'))) {
      return false;
    }
  }
  return true;
}

inline ManifestValidation validateManifest(
    const FirmwareManifest& manifest, const OtaContext& context) {
  if (!context.timeSynced)
    return {false, ManifestReason::TimeUnsynced};
  if (!mayStart(context)) return {false, ManifestReason::Busy};
  if (manifest.protocolVersion != 1)
    return {false, ManifestReason::BadProtocol};
  if (!isUuid(manifest.updateId)) return {false, ManifestReason::BadUpdateId};
  if (!manifest.version || manifest.version[0] == '\0')
    return {false, ManifestReason::BadVersion};
  if (manifest.buildNumber <= FIRMWARE_BUILD)
    return {false, ManifestReason::NotNewer};
  if (manifest.sizeBytes == 0) return {false, ManifestReason::InvalidSize};
  if (manifest.sizeBytes > OTA_MAX_IMAGE_BYTES)
    return {false, ManifestReason::TooLarge};
  if (!isLowercaseSha256(manifest.sha256))
    return {false, ManifestReason::BadHashFormat};
  if (manifest.expiresAtMs <= context.trustedTimeMs)
    return {false, ManifestReason::Expired};
  return {true, ManifestReason::None};
}

enum class OtaRecordState { None, Downloading, BootingNew, ResultPending };
enum class BootAction { None, ReportFailed, StartHealthGate, RetryReport };

struct OtaRecord {
  OtaRecordState state;
  const char* expectedVersion;
  std::uint32_t expectedBuild;
};

struct BootResolution {
  BootAction action;
  const char* result;
  const char* reason;
};

inline BootResolution resolveBoot(
    const OtaRecord& record,
    const char* runningVersion,
    std::uint32_t runningBuild) {
  switch (record.state) {
    case OtaRecordState::Downloading:
      return {BootAction::ReportFailed, "FAILED", "INTERRUPTED"};
    case OtaRecordState::BootingNew:
      if (record.expectedVersion && runningVersion &&
          std::strcmp(record.expectedVersion, runningVersion) == 0 &&
          record.expectedBuild == runningBuild) {
        return {BootAction::StartHealthGate, nullptr, nullptr};
      }
      return {BootAction::ReportFailed, "FAILED", "ROLLED_BACK"};
    case OtaRecordState::ResultPending:
      return {BootAction::RetryReport, nullptr, nullptr};
    case OtaRecordState::None:
      return {BootAction::None, nullptr, nullptr};
  }
  return {BootAction::None, nullptr, nullptr};
}

struct HealthFlags {
  bool storageReady;
  bool wifiConnected;
  bool ntpSynced;
  bool heartbeatAccepted;
};

enum class HealthState { Waiting, Healthy, Unhealthy };

inline HealthState healthGate(std::uint32_t elapsedMs, const HealthFlags& flags) {
  if (flags.storageReady && flags.wifiConnected && flags.ntpSynced &&
      flags.heartbeatAccepted && elapsedMs <= OTA_HEALTH_TIMEOUT_MS) {
    return HealthState::Healthy;
  }
  if (elapsedMs >= OTA_HEALTH_TIMEOUT_MS) return HealthState::Unhealthy;
  return HealthState::Waiting;
}

}  // namespace locker
