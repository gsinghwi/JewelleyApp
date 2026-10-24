package main

// HTTPS for the shop network.
//
// Public certificates (Let's Encrypt) cannot be issued for a laptop on a shop Wi-Fi, so the server
// creates its own small certificate authority ("JewelleryApp Shop CA (<laptop>)") on first start and
// issues a certificate for every address of this laptop (its IPs on the Wi-Fi, its name, localhost).
// The installer adds the CA to Windows on the server laptop; on other devices it is installed once
// from http://<laptop IP>:8090/setup. The certificate is re-issued automatically when the laptop's
// IP address changes; devices that trust the CA keep trusting it.
//
//   https://<laptop IP>:8443  - the app for every device (secure: passwords encrypted, camera works)
//   http://localhost:8090     - the app on the server laptop itself (also counts as secure)
//   http://<laptop IP>:8090   - only the setup page and certificate; everything else is redirected

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"html/template"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type shopTLS struct {
	dir    string
	mu     sync.RWMutex
	cert   *tls.Certificate
	leaf   *x509.Certificate
	ca     *x509.Certificate
	caKey  *ecdsa.PrivateKey
	caPEM  []byte
	hosts  []string
	issued time.Time
}

func newShopTLS(dataRootDir string) (*shopTLS, error) {
	s := &shopTLS{dir: filepath.Join(dataRootDir, "tls")}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return nil, err
	}
	if err := s.loadOrCreateCA(); err != nil {
		return nil, err
	}
	if err := s.refresh(); err != nil {
		return nil, err
	}
	go func() {
		for range time.Tick(5 * time.Minute) {
			_ = s.refresh() // new IP address on the Wi-Fi, or certificate close to expiry
		}
	}()
	return s, nil
}

func writePEM(path, typ string, der []byte, mode os.FileMode) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}), mode)
}

func readPEM(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	b, _ := pem.Decode(raw)
	if b == nil {
		return nil, errors.New("bad PEM in " + path)
	}
	return b.Bytes, nil
}

func serialNumber() *big.Int {
	n, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 120))
	return n
}

func (s *shopTLS) loadOrCreateCA() error {
	crtPath, keyPath := filepath.Join(s.dir, "ca.crt"), filepath.Join(s.dir, "ca.key")
	if der, err := readPEM(crtPath); err == nil {
		if kder, err := readPEM(keyPath); err == nil {
			ca, err1 := x509.ParseCertificate(der)
			key, err2 := x509.ParseECPrivateKey(kder)
			if err1 == nil && err2 == nil && time.Now().Before(ca.NotAfter) {
				s.ca, s.caKey = ca, key
				s.caPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
				return nil
			}
		}
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	host, _ := os.Hostname()
	tpl := &x509.Certificate{
		SerialNumber:          serialNumber(),
		Subject:               pkix.Name{CommonName: "JewelleryApp Shop CA (" + host + ")", Organization: []string{"JewelleryApp"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	kder, _ := x509.MarshalECPrivateKey(key)
	if err := writePEM(keyPath, "EC PRIVATE KEY", kder, 0o600); err != nil {
		return err
	}
	if err := writePEM(crtPath, "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	// a new CA makes the old server certificate useless
	os.Remove(filepath.Join(s.dir, "server.crt"))
	s.ca, _ = x509.ParseCertificate(der)
	s.caKey = key
	s.caPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return nil
}

// addresses the certificate must cover
func currentHosts() []string {
	hosts := []string{"localhost", "127.0.0.1", "::1"}
	if h, err := os.Hostname(); err == nil && h != "" {
		h = strings.ToLower(h)
		hosts = append(hosts, h, h+".local")
	}
	ifaces, _ := net.Interfaces()
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
				hosts = append(hosts, ipn.IP.String())
			}
		}
	}
	sort.Strings(hosts)
	return hosts
}

func certCovers(c *x509.Certificate, hosts []string) bool {
	for _, h := range hosts {
		if c.VerifyHostname(h) != nil {
			return false
		}
	}
	return true
}

func (s *shopTLS) refresh() error {
	hosts := currentHosts()
	s.mu.RLock()
	ok := s.leaf != nil && certCovers(s.leaf, hosts) && time.Until(s.leaf.NotAfter) > 60*24*time.Hour
	s.mu.RUnlock()
	if ok {
		return nil
	}
	crtPath, keyPath := filepath.Join(s.dir, "server.crt"), filepath.Join(s.dir, "server.key")
	// reuse the stored certificate if it still fits
	if c, err := tls.LoadX509KeyPair(crtPath, keyPath); err == nil {
		if leaf, err := x509.ParseCertificate(c.Certificate[0]); err == nil && certCovers(leaf, hosts) &&
			time.Until(leaf.NotAfter) > 60*24*time.Hour && leaf.CheckSignatureFrom(s.ca) == nil {
			s.set(&c, leaf, hosts)
			return nil
		}
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tpl := &x509.Certificate{
		SerialNumber: serialNumber(),
		Subject:      pkix.Name{CommonName: "JewelleryApp", Organization: []string{"JewelleryApp"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(0, 0, 820), // browsers accept at most 825 days
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tpl.IPAddresses = append(tpl.IPAddresses, ip)
		} else {
			tpl.DNSNames = append(tpl.DNSNames, h)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, s.ca, &key.PublicKey, s.caKey)
	if err != nil {
		return err
	}
	kder, _ := x509.MarshalECPrivateKey(key)
	if err := writePEM(keyPath, "EC PRIVATE KEY", kder, 0o600); err != nil {
		return err
	}
	if err := writePEM(crtPath, "CERTIFICATE", der, 0o644); err != nil {
		return err
	}
	c, err := tls.LoadX509KeyPair(crtPath, keyPath)
	if err != nil {
		return err
	}
	leaf, _ := x509.ParseCertificate(der)
	s.set(&c, leaf, hosts)
	return nil
}

func (s *shopTLS) set(c *tls.Certificate, leaf *x509.Certificate, hosts []string) {
	s.mu.Lock()
	s.cert, s.leaf, s.hosts, s.issued = c, leaf, hosts, time.Now()
	s.mu.Unlock()
}

func (s *shopTLS) GetCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cert, nil
}

func (s *shopTLS) TLSConfig() *tls.Config {
	return &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: s.GetCertificate, NextProtos: []string{"h2", "http/1.1"}}
}

// CA fingerprint people can compare on each device (SHA-256, grouped)
func (s *shopTLS) Fingerprint() string {
	sum := sha256.Sum256(s.ca.Raw)
	h := strings.ToUpper(hex.EncodeToString(sum[:]))
	var parts []string
	for i := 0; i < len(h); i += 4 {
		parts = append(parts, h[i:i+4])
	}
	return strings.Join(parts, " ")
}

func (s *shopTLS) CAName() string { return s.ca.Subject.CommonName }

// ---- plain HTTP listener ----

// httpHandler serves the full app to the server laptop itself (http://localhost is a secure
// context in browsers) and only the setup page / certificate to other devices.
func (s *shopTLS) httpHandler(app http.Handler, httpsPort string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup", "/setup/":
			s.serveSetup(w, r, httpsPort)
			return
		case "/jewelleryapp-ca.crt":
			s.serveCA(w)
			return
		case "/api/jw/health":
			app.ServeHTTP(w, r)
			return
		}
		if isLoopback(r) {
			app.ServeHTTP(w, r)
			return
		}
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil {
			host = r.Host
		}
		if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
			host = "[" + host + "]"
		}
		http.Redirect(w, r, "https://"+host+":"+httpsPort+r.URL.RequestURI(), http.StatusFound)
	})
}

func (s *shopTLS) serveCA(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="jewelleryapp-ca.crt"`)
	w.Write(s.caPEM)
}

var setupTpl = template.Must(template.New("setup").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up this device - JewelleryApp</title>
<style>
body{font:16px/1.55 "Segoe UI",system-ui,sans-serif;color:#2b2522;background:#fbf9f6;max-width:760px;margin:0 auto;padding:24px 16px 60px}
h1{color:#7a1f2b;border-bottom:3px solid #c9a227;padding-bottom:8px;font-size:1.6em}h2{color:#7a1f2b;font-size:1.15em;margin-top:1.6em}
.btn{display:inline-block;background:#7a1f2b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;margin:6px 0}
.btn.alt{background:#fff;color:#7a1f2b;border:2px solid #7a1f2b}code{background:#f1ebe4;padding:2px 6px;border-radius:4px;word-break:break-all}
.box{background:#fff;border:1px solid #e3dcd3;border-radius:10px;padding:14px 16px;margin:12px 0}ol li{margin:4px 0}
</style></head><body>
<h1>Set up this device for JewelleryApp</h1>
<p>JewelleryApp on this shop network uses a secure connection. Each laptop, tablet or phone needs the shop's certificate <b>once</b>; after that the app opens without warnings and the camera can scan QR codes.</p>
<div class="box"><b>1.</b> Download the shop certificate:<br><a class="btn" href="/jewelleryapp-ca.crt">Download certificate</a>
<p style="margin:6px 0 0;font-size:14px">Name: <code>{{.Name}}</code><br>Fingerprint (SHA-256): <code>{{.Fingerprint}}</code><br>
It must match the fingerprint shown on the server laptop in <b>Settings &rsaquo; Open on other laptops / tablets</b>.</p></div>
<div class="box"><b>2.</b> Install it:
<h2>Windows laptop</h2><ol><li>Open the downloaded <code>jewelleryapp-ca.crt</code>, click <b>Install Certificate</b>.</li>
<li>Choose <b>Local Machine</b> (or Current User), then <b>Place all certificates in the following store</b> &rsaquo; <b>Browse</b> &rsaquo; <b>Trusted Root Certification Authorities</b>.</li>
<li>Finish, accept the security warning, then close and reopen the browser.</li></ol>
<h2>Android phone / tablet</h2><ol><li>Settings &rsaquo; Security (or "Encryption &amp; credentials") &rsaquo; <b>Install a certificate</b> &rsaquo; <b>CA certificate</b>.</li>
<li>Choose the downloaded file and confirm.</li></ol>
<h2>iPhone / iPad</h2><ol><li>Open this page in Safari and download the certificate; tap <b>Allow</b>.</li>
<li>Settings &rsaquo; <b>Profile Downloaded</b> &rsaquo; Install.</li>
<li>Settings &rsaquo; General &rsaquo; About &rsaquo; <b>Certificate Trust Settings</b> &rsaquo; turn on <b>{{.Name}}</b>.</li></ol>
<h2>Mac</h2><ol><li>Open the file; it goes into Keychain Access (System keychain).</li><li>Double-click it, open <b>Trust</b>, set <b>Always Trust</b>.</li></ol></div>
<div class="box"><b>3.</b> Open JewelleryApp:<br>{{range .URLs}}<a class="btn alt" href="{{.}}">{{.}}</a><br>{{end}}
<p style="font-size:14px">Bookmark it. Each person signs in with their own username.</p></div>
</body></html>`))

func (s *shopTLS) serveSetup(w http.ResponseWriter, r *http.Request, httpsPort string) {
	var urls []string
	s.mu.RLock()
	for _, h := range s.hosts {
		if ip := net.ParseIP(h); ip != nil && ip.To4() != nil && !ip.IsLoopback() {
			urls = append(urls, "https://"+h+":"+httpsPort)
		}
	}
	s.mu.RUnlock()
	var buf bytes.Buffer
	if err := setupTpl.Execute(&buf, map[string]any{"Name": s.CAName(), "Fingerprint": s.Fingerprint(), "URLs": urls}); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(buf.Bytes())
}

func portOf(addr, def string) string {
	if _, p, err := net.SplitHostPort(addr); err == nil && p != "" {
		return p
	}
	return def
}
