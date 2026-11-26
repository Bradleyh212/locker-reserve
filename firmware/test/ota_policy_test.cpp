#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>

#include "config.example.h"
#include "ota_policy.h"

namespace {
locker::OtaContext readyContext() {
  return {false, false, true, true, true, 100000};
}

locker::FirmwareManifest validManifest() {
  return {
      1,
      "123e4567-e89b-12d3-a456-426614174000",
      "locker-firmware-0.4",
      4,
      4096,
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      200000,
  };
}
}  // namespace

int main() {
  using namespace locker;
  static_assert(OTA_ENABLED == false, "OTA must default to disabled");
  static_assert(OTA_MAX_IMAGE_BYTES == 1310720, "Image limit must match slot size");
  static_assert(FIRMWARE_BUILD == 3, "Expected phase 2 build number");

  auto context = readyContext();
  assert(mayStart(context));
  context.outputActive = true;
  assert(!mayStart(context));
  context.outputActive = false;
  context.pendingCommandReport = true;
  assert(!mayStart(context));
  context.pendingCommandReport = false;
  context.storageReady = false;
  assert(!mayStart(context));
  context.storageReady = true;
  context.wifiConnected = false;
  assert(!mayStart(context));
  context.wifiConnected = true;
  context.timeSynced = false;
  assert(!mayStart(context));

  context = readyContext();
  const auto manifest = validManifest();
  auto validation = validateManifest(manifest, context);
  assert(validation.valid && validation.reason == ManifestReason::None);

  auto invalid = manifest;
  invalid.protocolVersion = 2;
  assert(validateManifest(invalid, context).reason == ManifestReason::BadProtocol);
  assert(std::strcmp(reasonCode(ManifestReason::BadProtocol), "BAD_PROTOCOL") == 0);

  invalid = manifest;
  invalid.updateId = "bad-id";
  assert(validateManifest(invalid, context).reason == ManifestReason::BadUpdateId);
  invalid = manifest;
  invalid.version = "";
  assert(validateManifest(invalid, context).reason == ManifestReason::BadVersion);
  invalid = manifest;
  invalid.buildNumber = FIRMWARE_BUILD;
  assert(validateManifest(invalid, context).reason == ManifestReason::NotNewer);
  invalid = manifest;
  invalid.sizeBytes = 0;
  assert(validateManifest(invalid, context).reason == ManifestReason::InvalidSize);
  invalid = manifest;
  invalid.sizeBytes = OTA_MAX_IMAGE_BYTES;
  assert(validateManifest(invalid, context).valid);
  invalid = manifest;
  invalid.sizeBytes = OTA_MAX_IMAGE_BYTES + 1;
  assert(validateManifest(invalid, context).reason == ManifestReason::TooLarge);
  invalid = manifest;
  invalid.sha256 = "0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef";
  assert(validateManifest(invalid, context).reason == ManifestReason::BadHashFormat);
  invalid = manifest;
  invalid.expiresAtMs = context.trustedTimeMs;
  assert(validateManifest(invalid, context).reason == ManifestReason::Expired);
  auto busy = context;
  busy.outputActive = true;
  assert(validateManifest(manifest, busy).reason == ManifestReason::Busy);
  auto noTime = context;
  noTime.timeSynced = false;
  assert(validateManifest(manifest, noTime).reason == ManifestReason::TimeUnsynced);
  const ManifestReason reasons[] = {
      ManifestReason::None,         ManifestReason::Busy,
      ManifestReason::TimeUnsynced, ManifestReason::BadProtocol,
      ManifestReason::BadUpdateId,  ManifestReason::BadVersion,
      ManifestReason::NotNewer,     ManifestReason::InvalidSize,
      ManifestReason::TooLarge,     ManifestReason::BadHashFormat,
      ManifestReason::Expired,
  };
  for (const auto reason : reasons) {
    assert(std::strlen(reasonCode(reason)) <= 64);
  }

  auto boot = resolveBoot(
      {OtaRecordState::Downloading, nullptr, 0}, "locker-firmware-0.3", 3);
  assert(boot.action == BootAction::ReportFailed);
  assert(std::strcmp(boot.result, "FAILED") == 0);
  assert(std::strcmp(boot.reason, "INTERRUPTED") == 0);
  boot = resolveBoot(
      {OtaRecordState::BootingNew, "locker-firmware-0.4", 4},
      "locker-firmware-0.4",
      4);
  assert(boot.action == BootAction::StartHealthGate);
  boot = resolveBoot(
      {OtaRecordState::BootingNew, "locker-firmware-0.4", 4},
      "locker-firmware-0.3",
      3);
  assert(boot.action == BootAction::ReportFailed);
  assert(std::strcmp(boot.reason, "ROLLED_BACK") == 0);
  boot = resolveBoot(
      {OtaRecordState::ResultPending, nullptr, 0}, "locker-firmware-0.3", 3);
  assert(boot.action == BootAction::RetryReport);
  boot = resolveBoot(
      {OtaRecordState::None, nullptr, 0}, "locker-firmware-0.3", 3);
  assert(boot.action == BootAction::None);

  const HealthFlags healthy{true, true, true, true};
  assert(healthGate(59999, healthy) == HealthState::Healthy);
  assert(healthGate(60000, healthy) == HealthState::Healthy);
  const HealthFlags incomplete[] = {
      {false, true, true, true},
      {true, false, true, true},
      {true, true, false, true},
      {true, true, true, false},
  };
  for (const auto& flags : incomplete) {
    assert(healthGate(59999, flags) == HealthState::Waiting);
    assert(healthGate(60000, flags) == HealthState::Unhealthy);
  }

  std::cout << "PASS: OTA policy validation, boot resolution, and health gate\n";
}
