#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
// Activates Operit and returns a session handle; zero indicates failure.
uint64_t operit_sdk_connect(void);
// Sends one MessagePack envelope; zero indicates success.
int32_t operit_sdk_send(uint64_t handle, const uint8_t* bytes, size_t length);
// Returns 1 for an allocated message, 0 for timeout, and -1 for an error.
int32_t operit_sdk_next(uint64_t handle, uint32_t timeout_ms, uint8_t** bytes, size_t* length);
// Releases a message returned by operit_sdk_next.
void operit_sdk_free(uint8_t* bytes, size_t length);
// Closes one SDK session.
int32_t operit_sdk_close(uint64_t handle);
// Reads the current thread's last failure; the pointer is borrowed.
const char* operit_sdk_error(void);
#ifdef __cplusplus
}
#endif
