#pragma once
#include <cstdint>
#include <cstring>

namespace locker::protocol {
// Parse canonical API UTC timestamps without libc's process-global timezone.
inline int64_t timestamp(const char* s) {
  if (!s || std::strlen(s) != 24) return 0;
  for (int i = 0; i < 24; ++i) {
    const char expected = i == 4 || i == 7 ? '-' : i == 10 ? 'T' :
      i == 13 || i == 16 ? ':' : i == 19 ? '.' : i == 23 ? 'Z' : 0;
    if (expected ? s[i] != expected : s[i] < '0' || s[i] > '9') return 0;
  }
  auto number = [s](int start, int length) {
    int value = 0;
    for (int i = start; i < start + length; ++i) value = value * 10 + s[i] - '0';
    return value;
  };
  const int year = number(0, 4), month = number(5, 2), day = number(8, 2);
  const int hour = number(11, 2), minute = number(14, 2), second = number(17, 2);
  if (year < 2026 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return 0;
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  const int lengths[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  if (day < 1 || day > lengths[month - 1] + (month == 2 && leap ? 1 : 0)) return 0;
  auto leapsBefore = [](int y) { return (y - 1) / 4 - (y - 1) / 100 + (y - 1) / 400; };
  int64_t days = 365LL * (year - 1970) + leapsBefore(year) - leapsBefore(1970);
  for (int m = 1; m < month; ++m) days += lengths[m - 1] + (m == 2 && leap ? 1 : 0);
  days += day - 1;
  return ((days * 24 + hour) * 3600 + minute * 60 + second) * 1000 + number(20, 3);
}

inline bool commandId(const char* id) {
  if (!id || std::strlen(id) != 36) return false;
  for (int i = 0; i < 36; ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (id[i] != '-') return false; }
    else if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f') ||
               (id[i] >= 'A' && id[i] <= 'F'))) return false;
  }
  return true;
}

inline const char* rejection(bool versionAndType, bool durationValid, int64_t issued,
                            int64_t expires, int64_t now, int64_t watermark, bool enabled) {
  if (!versionAndType) return "INVALID_COMMAND_TYPE_OR_VERSION";
  if (!durationValid) return "INVALID_PULSE_DURATION";
  if (issued <= 0 || expires <= 0 || expires <= issued || expires - issued > 10000)
    return "INVALID_TIMESTAMPS";
  if (issued <= watermark) return "STALE_COMMAND";
  if (issued > now + 1000) return "ISSUED_IN_FUTURE";
  if (expires <= now + 1000) return "EXPIRED_COMMAND";
  if (!enabled) return "ACTUATION_DISABLED";
  return nullptr;
}

// Permanent HTTP rejection requires operator reconciliation, not forgetting a result.
inline bool terminalReportStatus(int status) {
  return status >= 400 && status < 500 && status != 408 && status != 429;
}
inline uint32_t nextRetryDelay(uint32_t delay) { return delay >= 30000 ? 60000 : delay * 2; }
} // namespace locker::protocol
