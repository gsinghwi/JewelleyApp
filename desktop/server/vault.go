package main

// Protecting what leaves the laptop in a backup.
//
//  - The Razorpay / WhatsApp keys are stored encrypted with a key file that lives OUTSIDE the
//    database folder (<data folder>\keys\secrets.key), so it is never inside a backup. After a
//    restore on another laptop the keys simply have to be entered again.
//  - The superuser note (emergency login) also lives outside the database folder.
//  - Backups copied to the backup folder are encrypted with the backup password the Admin sets
//    in Settings (AES-256-GCM, key from scrypt). Without the password they cannot be read.

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/crypto/scrypt"
)

// folder that holds pb_data, logs, keys and the superuser note
func dataRoot(app core.App) string { return filepath.Dir(app.DataDir()) }

func superuserNotePath(app core.App) string {
	return filepath.Join(dataRoot(app), "superuser-login.txt")
}

var (
	vaultMu  sync.Mutex
	vaultKey []byte
)

func secretsKey(app core.App) ([]byte, error) {
	vaultMu.Lock()
	defer vaultMu.Unlock()
	if vaultKey != nil {
		return vaultKey, nil
	}
	path := filepath.Join(dataRoot(app), "keys", "secrets.key")
	if raw, err := os.ReadFile(path); err == nil && len(raw) == 32 {
		vaultKey = raw
		return vaultKey, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	vaultKey = key
	return vaultKey, nil
}

func sealBytes(key, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plain, nil), nil
}

func openBytes(key, sealed []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(sealed) < gcm.NonceSize() {
		return nil, errors.New("data too short")
	}
	return gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], nil)
}

// sealSecret / openSecret store a secret map as {"enc": "<base64>"}
func sealSecret(app core.App, data map[string]any) (map[string]any, error) {
	key, err := secretsKey(app)
	if err != nil {
		return nil, err
	}
	plain, _ := json.Marshal(data)
	sealed, err := sealBytes(key, plain)
	if err != nil {
		return nil, err
	}
	return map[string]any{"enc": base64.StdEncoding.EncodeToString(sealed)}, nil
}

func openSecret(app core.App, stored map[string]any) map[string]any {
	enc, ok := stored["enc"].(string)
	if !ok {
		return stored // stored before encryption was added; re-saved encrypted at start-up
	}
	key, err := secretsKey(app)
	if err != nil {
		return map[string]any{}
	}
	sealed, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return map[string]any{}
	}
	plain, err := openBytes(key, sealed)
	if err != nil {
		// restored from another laptop: the key file is not here, the keys must be entered again
		return map[string]any{}
	}
	out := map[string]any{}
	_ = json.Unmarshal(plain, &out)
	return out
}

// protectAtRest runs at start-up: encrypts secrets saved by older versions and moves the
// superuser note out of the database folder
func protectAtRest(app core.App) {
	recs, err := app.FindAllRecords("secrets")
	if err == nil {
		for _, r := range recs {
			d := appData(r)
			if _, ok := d["enc"]; ok {
				continue
			}
			if sealed, err := sealSecret(app, d); err == nil {
				r.Set("data", sealed)
				_ = app.Save(r)
			}
		}
	}
	old := filepath.Join(app.DataDir(), "superuser-login.txt")
	if _, err := os.Stat(old); err == nil {
		if err := os.Rename(old, superuserNotePath(app)); err != nil {
			os.Remove(old)
		}
	}
}

// ---- encrypted backup files ----

var backupMagic = []byte("JWBAK1\n")

const encBackupExt = ".jwbackup"

func backupKeyFromPassword(password string, salt []byte) ([]byte, error) {
	return scrypt.Key([]byte(password), salt, 1<<15, 8, 1, 32)
}

// encryptFile writes src encrypted with the password to dst
func encryptFile(src, dst, password string) (int64, error) {
	plain, err := os.ReadFile(src)
	if err != nil {
		return 0, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return 0, err
	}
	key, err := backupKeyFromPassword(password, salt)
	if err != nil {
		return 0, err
	}
	sealed, err := sealBytes(key, plain)
	if err != nil {
		return 0, err
	}
	var buf bytes.Buffer
	buf.Write(backupMagic)
	buf.Write(salt)
	buf.Write(sealed)
	tmp := dst + ".part"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o600); err != nil {
		return 0, err
	}
	return int64(buf.Len()), os.Rename(tmp, dst)
}

func isEncryptedBackup(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	head := make([]byte, len(backupMagic))
	if _, err := io.ReadFull(f, head); err != nil {
		return false
	}
	return bytes.Equal(head, backupMagic)
}

// decryptFile writes the decrypted zip of an encrypted backup to dst
func decryptFile(src, dst, password string) error {
	raw, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if !bytes.HasPrefix(raw, backupMagic) || len(raw) < len(backupMagic)+16 {
		return errors.New("this is not an encrypted JewelleryApp backup")
	}
	raw = raw[len(backupMagic):]
	key, err := backupKeyFromPassword(password, raw[:16])
	if err != nil {
		return err
	}
	plain, err := openBytes(key, raw[16:])
	if err != nil {
		return errors.New("wrong backup password, or the file is damaged")
	}
	return os.WriteFile(dst, plain, 0o600)
}
