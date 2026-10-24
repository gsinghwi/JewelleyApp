//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// For trying the launcher on Linux / macOS during development

func messageBox(title, text string, isError bool) {
	fmt.Fprintln(os.Stderr, title+": "+text)
}

func openDefault(url string) error {
	return exec.Command("xdg-open", url).Start()
}
