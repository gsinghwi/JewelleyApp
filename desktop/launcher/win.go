//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func messageBox(title, text string, isError bool) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	flags := uintptr(0x40) // information icon
	if isError {
		flags = 0x10
	}
	proc.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}

func openDefault(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
