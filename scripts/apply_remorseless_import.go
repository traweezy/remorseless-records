package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultUploaderPath  = "tmp/phase6-uploader-ready.csv"
	defaultCatalogPath   = "tmp/phase6-catalog-upserts.json"
	defaultInventoryPath = "tmp/phase6-inventory-levels.csv"
	defaultPreviewPath   = "tmp/phase6-import-preview.json"
	applyConfirmation    = "APPLY_REMORSELESS_CATALOG_TO_STAGING"
)

type config struct {
	Mode          string
	BaseURL       string
	Environment   string
	UploaderPath  string
	CatalogPath   string
	InventoryPath string
	PreviewPath   string
	BackupPath    string
	Confirm       string
	AllowExisting bool
	Email         string
	Password      string
}

type client struct {
	baseURL string
	token   string
	http    *http.Client
}

type previewArtifact struct {
	NormalizedProductCount int               `json:"normalized_product_count"`
	VariantCount           int               `json:"variant_count"`
	AmbiguityCount         int               `json:"ambiguity_count"`
	SHA256                 map[string]string `json:"sha256"`
}

type catalogArtifact struct {
	GeneratedAt      string                   `json:"generated_at"`
	ReferenceValues  []catalogReferenceValue  `json:"reference_values"`
	Artists          []catalogArtist          `json:"artists"`
	ProductProfiles  []catalogProductProfile  `json:"product_profiles"`
	VariantProfiles  []catalogVariantProfile  `json:"variant_profiles"`
	Media            []catalogMediaItem       `json:"media"`
	Bundles          []catalogBundleProfile   `json:"bundles"`
	BundleComponents []catalogBundleComponent `json:"bundle_components"`
}

type catalogReferenceValue struct {
	Kind  string `json:"kind"`
	Label string `json:"label"`
	Value string `json:"value"`
}

type catalogArtist struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

type profileReference struct {
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	SortOrder int    `json:"sort_order"`
}

type catalogProductProfile struct {
	ProductHandle   string             `json:"product_handle"`
	ReleaseTitle    string             `json:"release_title"`
	Label           string             `json:"label"`
	ProductType     string             `json:"product_type"`
	ReleaseDate     string             `json:"release_date"`
	ReleaseYear     int                `json:"release_year"`
	DescriptionHTML string             `json:"description_html"`
	SearchKeywords  []string           `json:"search_keywords"`
	Artists         []string           `json:"artists"`
	References      []profileReference `json:"references"`
	Tracklist       []any              `json:"tracklist"`
	Credits         map[string]any     `json:"credits"`
	PressingNotes   map[string]any     `json:"pressing_notes"`
	MerchDetails    map[string]any     `json:"merch_details"`
	Metadata        map[string]any     `json:"metadata"`
}

type catalogVariantProfile struct {
	ProductHandle       string         `json:"product_handle"`
	VariantSKU          string         `json:"variant_sku"`
	Format              string         `json:"format"`
	FormatDetail        string         `json:"format_detail"`
	DisplayLabel        string         `json:"display_label"`
	PreorderAllowed     bool           `json:"preorder_allowed"`
	PreorderReleaseDate string         `json:"preorder_release_date"`
	BackorderAllowed    bool           `json:"backorder_allowed"`
	BackorderNote       string         `json:"backorder_note"`
	ImageURL            string         `json:"image_url"`
	Metadata            map[string]any `json:"metadata"`
}

type catalogMediaItem struct {
	ProductHandle    string         `json:"product_handle"`
	VariantSKU       string         `json:"variant_sku"`
	SourceURL        string         `json:"source_url"`
	Role             string         `json:"role"`
	SortOrder        int            `json:"sort_order"`
	IsPrimary        bool           `json:"is_primary"`
	AltText          string         `json:"alt_text"`
	DerivativeStatus string         `json:"derivative_status"`
	Metadata         map[string]any `json:"metadata"`
}

type catalogBundleProfile struct {
	ProductHandle   string         `json:"product_handle"`
	BundleType      string         `json:"bundle_type"`
	InventoryMode   string         `json:"inventory_mode"`
	FulfillmentMode string         `json:"fulfillment_mode"`
	DisplayTitle    string         `json:"display_title"`
	DescriptionHTML string         `json:"description_html"`
	IsActive        bool           `json:"is_active"`
	Metadata        map[string]any `json:"metadata"`
}

type bundleVariantMapping struct {
	BundleVariantSKUs    []string `json:"bundle_variant_skus"`
	ComponentVariantSKUs []string `json:"component_variant_skus"`
	SelectionMode        string   `json:"selection_mode"`
}

type catalogBundleComponent struct {
	BundleHandle           string                 `json:"bundle_handle"`
	ComponentProductHandle string                 `json:"component_product_handle"`
	ComponentVariantSKUs   []string               `json:"component_variant_skus"`
	BundleVariantSKUs      []string               `json:"bundle_variant_skus"`
	Title                  string                 `json:"title"`
	Quantity               int                    `json:"quantity"`
	SortOrder              int                    `json:"sort_order"`
	IsRequired             bool                   `json:"is_required"`
	SelectionMode          string                 `json:"selection_mode"`
	ComponentKind          string                 `json:"component_kind"`
	VariantMappings        []bundleVariantMapping `json:"variant_mappings"`
	Metadata               map[string]any         `json:"metadata"`
}

type inventoryRow struct {
	ProductHandle string
	VariantSKU    string
	StockLocation string
	Stocked       int
	Incoming      int
	Required      int
}

type adminInventoryItemLink struct {
	InventoryItemID string `json:"inventory_item_id"`
}

type adminVariant struct {
	ID             string                   `json:"id"`
	SKU            string                   `json:"sku"`
	InventoryItems []adminInventoryItemLink `json:"inventory_items"`
}

type adminProduct struct {
	ID       string         `json:"id"`
	Handle   string         `json:"handle"`
	Variants []adminVariant `json:"variants"`
}

type productListResponse struct {
	Products []adminProduct `json:"products"`
	Count    int            `json:"count"`
	Offset   int            `json:"offset"`
	Limit    int            `json:"limit"`
}

type referenceListResponse struct {
	Values []struct {
		ID    string `json:"id"`
		Kind  string `json:"kind"`
		Label string `json:"label"`
		Value string `json:"value"`
	} `json:"values"`
	Count int `json:"count"`
}

type artistListResponse struct {
	Artists []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Slug string `json:"slug"`
	} `json:"artists"`
	Count int `json:"count"`
}

type importBackup struct {
	GeneratedAt        string            `json:"generated_at"`
	BaseURL            string            `json:"base_url"`
	Environment        string            `json:"environment"`
	ProductsBefore     []adminProduct    `json:"products_before"`
	ArtistIDsBefore    []string          `json:"artist_ids_before"`
	ReferenceIDsBefore []string          `json:"reference_ids_before"`
	CreatedHandles     []string          `json:"created_handles"`
	AppliedHandles     []string          `json:"applied_handles"`
	AppliedVariantSKUs []string          `json:"applied_variant_skus"`
	ArtifactSHA256     map[string]string `json:"artifact_sha256"`
}

type resolvedCatalog struct {
	productByHandle map[string]adminProduct
	variantBySKU    map[string]adminVariant
}

func main() {
	cfg := parseFlags()
	if err := run(cfg); err != nil {
		fmt.Fprintln(os.Stderr, "catalog import failed:", err)
		os.Exit(1)
	}
}

func parseFlags() config {
	mode := flag.String("mode", "dry-run", "dry-run, apply, or rollback")
	baseURL := flag.String("base-url", strings.TrimSpace(os.Getenv("MEDUSA_BACKEND_URL")), "Medusa backend URL")
	environment := flag.String("environment", "staging", "target environment; only staging is allowed")
	uploader := flag.String("uploader", defaultUploaderPath, "uploader-ready CSV")
	catalog := flag.String("catalog", defaultCatalogPath, "catalog JSON")
	inventory := flag.String("inventory", defaultInventoryPath, "inventory CSV")
	preview := flag.String("preview", defaultPreviewPath, "preview JSON")
	backup := flag.String("backup", "", "backup/checkpoint JSON path")
	confirm := flag.String("confirm", "", "required staging apply confirmation")
	allowExisting := flag.Bool("allow-existing", false, "allow idempotent updates to existing imported handles")
	flag.Parse()
	return config{
		Mode: *mode, BaseURL: strings.TrimRight(*baseURL, "/"), Environment: *environment,
		UploaderPath: *uploader, CatalogPath: *catalog, InventoryPath: *inventory,
		PreviewPath: *preview, BackupPath: *backup, Confirm: *confirm,
		AllowExisting: *allowExisting,
		Email:         strings.TrimSpace(os.Getenv("MEDUSA_ADMIN_EMAIL")),
		Password:      os.Getenv("MEDUSA_ADMIN_PASSWORD"),
	}
}

func run(cfg config) error {
	if cfg.Environment != "staging" {
		return fmt.Errorf("refusing target environment %q; only staging is allowed", cfg.Environment)
	}
	if cfg.BaseURL == "" || (!strings.Contains(cfg.BaseURL, "staging") && os.Getenv("ALLOW_NONSTANDARD_STAGING_URL") != "true") {
		return errors.New("base URL must identify staging (or set ALLOW_NONSTANDARD_STAGING_URL=true explicitly)")
	}
	if cfg.Email == "" || cfg.Password == "" {
		return errors.New("MEDUSA_ADMIN_EMAIL and MEDUSA_ADMIN_PASSWORD are required")
	}
	if cfg.Mode != "dry-run" && cfg.Mode != "apply" && cfg.Mode != "rollback" {
		return fmt.Errorf("unsupported mode %q", cfg.Mode)
	}

	catalog, preview, inventory, hashes, err := loadAndValidateArtifacts(cfg)
	if err != nil && cfg.Mode != "rollback" {
		return err
	}
	c := &client{baseURL: cfg.BaseURL, http: &http.Client{Timeout: 15 * time.Minute}}
	if err := c.authenticate(cfg.Email, cfg.Password); err != nil {
		return err
	}
	if cfg.Mode == "rollback" {
		return c.rollback(cfg)
	}

	products, err := c.listProducts()
	if err != nil {
		return err
	}
	productHandles := artifactProductHandles(catalog)
	existing := intersectHandles(products, productHandles)
	fmt.Printf("validated artifacts: products=%d variants=%d catalog_profiles=%d media=%d bundles=%d ambiguities=%d\n",
		preview.NormalizedProductCount, preview.VariantCount, len(catalog.ProductProfiles), len(catalog.Media), len(catalog.Bundles), preview.AmbiguityCount)
	fmt.Printf("target: %s (%s), existing matching handles=%d\n", cfg.BaseURL, cfg.Environment, len(existing))
	if cfg.Mode == "dry-run" {
		fmt.Printf("dry-run complete; sha256=%v inventory_rows=%d\n", hashes, len(inventory))
		if len(existing) > 0 && !cfg.AllowExisting {
			fmt.Println("apply will require --allow-existing because matching handles already exist")
		}
		return nil
	}
	if cfg.Confirm != applyConfirmation {
		return fmt.Errorf("apply requires --confirm %s", applyConfirmation)
	}
	if len(existing) > 0 && !cfg.AllowExisting {
		return fmt.Errorf("%d matching handles already exist; rerun dry-run and pass --allow-existing only for a reviewed idempotent rerun", len(existing))
	}
	return c.apply(cfg, catalog, inventory, hashes, products, productHandles)
}

func loadAndValidateArtifacts(cfg config) (catalogArtifact, previewArtifact, []inventoryRow, map[string]string, error) {
	var catalog catalogArtifact
	var preview previewArtifact
	if err := readJSON(cfg.CatalogPath, &catalog); err != nil {
		return catalog, preview, nil, nil, err
	}
	if err := readJSON(cfg.PreviewPath, &preview); err != nil {
		return catalog, preview, nil, nil, err
	}
	rows, err := readInventory(cfg.InventoryPath)
	if err != nil {
		return catalog, preview, nil, nil, err
	}
	if preview.AmbiguityCount != 0 {
		return catalog, preview, nil, nil, fmt.Errorf("preview has %d unresolved ambiguities", preview.AmbiguityCount)
	}
	if len(catalog.ProductProfiles) != preview.NormalizedProductCount || len(catalog.VariantProfiles) != preview.VariantCount {
		return catalog, preview, nil, nil, errors.New("artifact counts do not match preview")
	}
	paths := map[string]string{"uploader": cfg.UploaderPath, "catalog": cfg.CatalogPath, "inventory": cfg.InventoryPath}
	hashes := map[string]string{}
	for name, path := range paths {
		hash, err := fileSHA256(path)
		if err != nil {
			return catalog, preview, nil, nil, err
		}
		hashes[name] = hash
	}
	for previewName, expected := range preview.SHA256 {
		for name, actual := range hashes {
			if strings.Contains(previewName, name) && expected != actual {
				return catalog, preview, nil, nil, fmt.Errorf("%s checksum mismatch", name)
			}
		}
	}
	return catalog, preview, rows, hashes, nil
}

func readJSON(path string, target any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func readInventory(path string) ([]inventoryRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	r := csv.NewReader(f)
	records, err := r.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(records) < 2 {
		return nil, errors.New("inventory CSV is empty")
	}
	idx := map[string]int{}
	for i, name := range records[0] {
		idx[name] = i
	}
	requiredHeaders := []string{"product_handle", "variant_sku", "stock_location_id", "stocked_quantity", "incoming_quantity", "required_quantity"}
	for _, name := range requiredHeaders {
		if _, ok := idx[name]; !ok {
			return nil, fmt.Errorf("inventory CSV missing %s", name)
		}
	}
	rows := make([]inventoryRow, 0, len(records)-1)
	for _, record := range records[1:] {
		atoi := func(name string) (int, error) { return strconv.Atoi(record[idx[name]]) }
		stocked, err := atoi("stocked_quantity")
		if err != nil {
			return nil, err
		}
		incoming, err := atoi("incoming_quantity")
		if err != nil {
			return nil, err
		}
		required, err := atoi("required_quantity")
		if err != nil {
			return nil, err
		}
		rows = append(rows, inventoryRow{record[idx["product_handle"]], record[idx["variant_sku"]], record[idx["stock_location_id"]], stocked, incoming, required})
	}
	return rows, nil
}

func (c *client) authenticate(email, password string) error {
	var response struct {
		Token string `json:"token"`
	}
	if err := c.requestJSON(http.MethodPost, "/auth/user/emailpass", map[string]any{"email": email, "password": password}, &response); err != nil {
		return fmt.Errorf("authenticate: %w", err)
	}
	if response.Token == "" {
		return errors.New("authentication response did not include a token")
	}
	c.token = response.Token
	return nil
}

func (c *client) requestJSON(method, path string, body any, target any) error {
	var encoded []byte
	if body != nil {
		var err error
		encoded, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}

	const maxAttempts = 4
	retryableMethod := method == http.MethodGet || method == http.MethodPut
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(encoded)
		}
		req, err := http.NewRequestWithContext(context.Background(), method, c.baseURL+path, reader)
		if err != nil {
			return err
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.token != "" {
			req.Header.Set("Authorization", "Bearer "+c.token)
		}
		resp, err := c.http.Do(req)
		if err != nil {
			if retryableMethod && attempt < maxAttempts {
				time.Sleep(time.Duration(1<<(attempt-1)) * 250 * time.Millisecond)
				continue
			}
			return err
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if readErr != nil {
			return readErr
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			retryableStatus := resp.StatusCode == http.StatusTooManyRequests ||
				resp.StatusCode == http.StatusBadGateway ||
				resp.StatusCode == http.StatusServiceUnavailable ||
				resp.StatusCode == http.StatusGatewayTimeout
			if retryableMethod && retryableStatus && attempt < maxAttempts {
				fmt.Printf("transient %d for %s %s; retrying (%d/%d)\n", resp.StatusCode, method, path, attempt+1, maxAttempts)
				time.Sleep(time.Duration(1<<(attempt-1)) * 250 * time.Millisecond)
				continue
			}
			return fmt.Errorf("%s %s returned %d: %s", method, path, resp.StatusCode, truncate(string(data), 2000))
		}
		if target != nil && len(data) > 0 {
			if err := json.Unmarshal(data, target); err != nil {
				return fmt.Errorf("decode %s: %w", path, err)
			}
		}
		return nil
	}
	return fmt.Errorf("%s %s exhausted retries", method, path)
}

func (c *client) upload(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", filepath.Base(path))
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/admin/uploads", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upload returned %d: %s", resp.StatusCode, truncate(string(data), 2000))
	}
	var result struct {
		Files []struct {
			ID string `json:"id"`
		} `json:"files"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return "", err
	}
	if len(result.Files) != 1 || result.Files[0].ID == "" {
		return "", errors.New("upload response missing file id")
	}
	return result.Files[0].ID, nil
}

func (c *client) listProducts() ([]adminProduct, error) {
	var all []adminProduct
	for offset := 0; ; offset += 200 {
		query := url.Values{"limit": {"200"}, "offset": {strconv.Itoa(offset)}, "fields": {"id,handle,*variants,variants.inventory_items.inventory_item_id"}}
		var response productListResponse
		if err := c.requestJSON(http.MethodGet, "/admin/products?"+query.Encode(), nil, &response); err != nil {
			return nil, err
		}
		all = append(all, response.Products...)
		if len(all) >= response.Count || len(response.Products) == 0 {
			break
		}
	}
	return all, nil
}

func (c *client) listReferences() (referenceListResponse, error) {
	var response referenceListResponse
	err := c.requestJSON(http.MethodGet, "/admin/catalog/reference-values?limit=500", nil, &response)
	return response, err
}

func (c *client) listArtists() (artistListResponse, error) {
	var response artistListResponse
	err := c.requestJSON(http.MethodGet, "/admin/catalog/artists?limit=500", nil, &response)
	return response, err
}

func artifactProductHandles(catalog catalogArtifact) []string {
	set := map[string]bool{}
	for _, profile := range catalog.ProductProfiles {
		set[profile.ProductHandle] = true
	}
	result := make([]string, 0, len(set))
	for handle := range set {
		result = append(result, handle)
	}
	sort.Strings(result)
	return result
}

func artifactVariantSKUs(catalog catalogArtifact) []string {
	result := make([]string, 0, len(catalog.VariantProfiles))
	for _, profile := range catalog.VariantProfiles {
		result = append(result, profile.VariantSKU)
	}
	sort.Strings(result)
	return result
}

func intersectHandles(products []adminProduct, handles []string) []string {
	wanted := map[string]bool{}
	for _, handle := range handles {
		wanted[handle] = true
	}
	var result []string
	for _, product := range products {
		if wanted[product.Handle] {
			result = append(result, product.Handle)
		}
	}
	sort.Strings(result)
	return result
}

func resolveProducts(products []adminProduct) resolvedCatalog {
	resolved := resolvedCatalog{productByHandle: map[string]adminProduct{}, variantBySKU: map[string]adminVariant{}}
	for _, product := range products {
		resolved.productByHandle[product.Handle] = product
		for _, variant := range product.Variants {
			resolved.variantBySKU[variant.SKU] = variant
		}
	}
	return resolved
}

func (c *client) apply(cfg config, catalog catalogArtifact, inventory []inventoryRow, hashes map[string]string, before []adminProduct, handles []string) error {
	references, err := c.listReferences()
	if err != nil {
		return err
	}
	artists, err := c.listArtists()
	if err != nil {
		return err
	}
	backupPath := cfg.BackupPath
	if backupPath == "" {
		backupPath = filepath.Join("tmp", "phase6-staging-preapply-"+time.Now().UTC().Format("20060102T150405Z")+".json")
	}
	beforeHandles := map[string]bool{}
	for _, product := range before {
		beforeHandles[product.Handle] = true
	}
	createdHandles := []string{}
	for _, handle := range handles {
		if !beforeHandles[handle] {
			createdHandles = append(createdHandles, handle)
		}
	}
	backup := importBackup{time.Now().UTC().Format(time.RFC3339), cfg.BaseURL, cfg.Environment, before, idsFromArtists(artists), idsFromReferences(references), createdHandles, handles, artifactVariantSKUs(catalog), hashes}
	if err := writeJSON(backupPath, backup); err != nil {
		return err
	}
	fmt.Println("pre-apply backup/checkpoint:", backupPath)

	fileID, err := c.upload(cfg.UploaderPath)
	if err != nil {
		return err
	}
	uploadInfo, err := os.Stat(cfg.UploaderPath)
	if err != nil {
		return fmt.Errorf("inspect uploader artifact: %w", err)
	}
	var plan struct {
		TransactionID string         `json:"transaction_id"`
		Summary       map[string]any `json:"summary"`
	}
	if err := c.requestJSON(http.MethodPost, "/admin/products/imports", map[string]any{
		"file_key":     fileID,
		"originalname": filepath.Base(cfg.UploaderPath),
		"extension":    "csv",
		"size":         uploadInfo.Size(),
		"mime_type":    "text/csv",
	}, &plan); err != nil {
		return err
	}
	if plan.TransactionID == "" {
		return errors.New("product import did not return transaction_id")
	}
	fmt.Printf("product import plan: transaction=%s summary=%v\n", plan.TransactionID, plan.Summary)
	if err := c.requestJSON(http.MethodPost, "/admin/products/imports/"+url.PathEscape(plan.TransactionID)+"/confirm", map[string]any{}, nil); err != nil {
		return err
	}

	products, err := c.waitForProducts(handles, artifactVariantSKUs(catalog), 10*time.Minute)
	if err != nil {
		return err
	}
	resolved := resolveProducts(products)
	if err := c.applyInventory(inventory, resolved); err != nil {
		return err
	}
	if err := c.ensureReferences(catalog.ReferenceValues); err != nil {
		return err
	}
	if err := c.ensureArtists(catalog.Artists); err != nil {
		return err
	}
	if err := c.applyProductProfiles(catalog.ProductProfiles, resolved); err != nil {
		return err
	}
	if err := c.applyVariantProfiles(catalog.VariantProfiles, resolved); err != nil {
		return err
	}
	if err := c.applyMedia(catalog.Media, resolved); err != nil {
		return err
	}
	if err := c.applyBundles(catalog.Bundles, catalog.BundleComponents, resolved); err != nil {
		return err
	}
	fmt.Printf("apply complete: products=%d variants=%d media=%d bundles=%d\n", len(handles), len(catalog.VariantProfiles), len(catalog.Media), len(catalog.Bundles))
	return nil
}

func (c *client) waitForProducts(handles, skus []string, timeout time.Duration) ([]adminProduct, error) {
	deadline := time.Now().Add(timeout)
	wantedHandles := toSet(handles)
	wantedSKUs := toSet(skus)
	for {
		products, err := c.listProducts()
		if err != nil {
			return nil, err
		}
		resolved := resolveProducts(products)
		missingHandles, missingSKUs := 0, 0
		for handle := range wantedHandles {
			if _, ok := resolved.productByHandle[handle]; !ok {
				missingHandles++
			}
		}
		for sku := range wantedSKUs {
			if _, ok := resolved.variantBySKU[sku]; !ok {
				missingSKUs++
			}
		}
		if missingHandles == 0 && missingSKUs == 0 {
			return products, nil
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("timed out waiting for import: missing handles=%d skus=%d", missingHandles, missingSKUs)
		}
		fmt.Printf("waiting for imported products: missing handles=%d skus=%d\n", missingHandles, missingSKUs)
		time.Sleep(5 * time.Second)
	}
}

func (c *client) applyInventory(rows []inventoryRow, resolved resolvedCatalog) error {
	return runWorkers(rows, 8, func(row inventoryRow) error {
		variant, ok := resolved.variantBySKU[row.VariantSKU]
		if !ok {
			return fmt.Errorf("inventory SKU not found: %s", row.VariantSKU)
		}
		if len(variant.InventoryItems) == 0 {
			return fmt.Errorf("variant %s has no inventory item", row.VariantSKU)
		}
		itemID := variant.InventoryItems[0].InventoryItemID
		locationID := strings.TrimSpace(os.ExpandEnv(row.StockLocation))
		if locationID == "" || strings.Contains(locationID, "${") {
			locationID = strings.TrimSpace(os.Getenv("MEDUSA_STOCK_LOCATION_ID"))
		}
		if locationID == "" {
			return errors.New("MEDUSA_STOCK_LOCATION_ID is required")
		}
		body := map[string]any{"stocked_quantity": row.Stocked, "incoming_quantity": row.Incoming}
		path := "/admin/inventory-items/" + url.PathEscape(itemID) + "/location-levels/" + url.PathEscape(locationID)
		if err := c.requestJSON(http.MethodPost, path, body, nil); err == nil {
			return nil
		}
		return c.requestJSON(http.MethodPost, "/admin/inventory-items/"+url.PathEscape(itemID)+"/location-levels", map[string]any{"location_id": locationID, "stocked_quantity": row.Stocked, "incoming_quantity": row.Incoming}, nil)
	})
}

func (c *client) ensureReferences(values []catalogReferenceValue) error {
	existing, err := c.listReferences()
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, value := range existing.Values {
		seen[value.Kind+"\x00"+value.Value] = true
	}
	for _, value := range values {
		key := value.Kind + "\x00" + value.Value
		if seen[key] {
			continue
		}
		if err := c.requestJSON(http.MethodPost, "/admin/catalog/reference-values", map[string]any{"kind": value.Kind, "label": value.Label, "value": value.Value}, nil); err != nil {
			return err
		}
		seen[key] = true
	}
	return nil
}

func (c *client) ensureArtists(values []catalogArtist) error {
	existing, err := c.listArtists()
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, artist := range existing.Artists {
		seen[artist.Slug] = true
	}
	for _, artist := range values {
		if seen[artist.Slug] {
			continue
		}
		if err := c.requestJSON(http.MethodPost, "/admin/catalog/artists", map[string]any{"name": artist.Name, "slug": artist.Slug, "sortName": artist.Name}, nil); err != nil {
			return err
		}
		seen[artist.Slug] = true
	}
	return nil
}

func (c *client) applyProductProfiles(profiles []catalogProductProfile, resolved resolvedCatalog) error {
	return runWorkers(profiles, 6, func(profile catalogProductProfile) error {
		product, ok := resolved.productByHandle[profile.ProductHandle]
		if !ok {
			return fmt.Errorf("profile handle not found: %s", profile.ProductHandle)
		}
		artists := make([]map[string]any, 0, len(profile.Artists))
		for i, name := range profile.Artists {
			artists = append(artists, map[string]any{"name": name, "displayName": name, "role": "primary", "sortOrder": i})
		}
		references := make([]map[string]any, 0, len(profile.References))
		for _, ref := range profile.References {
			references = append(references, map[string]any{"kind": ref.Kind, "label": ref.Label, "sortOrder": ref.SortOrder})
		}
		body := map[string]any{"releaseTitle": profile.ReleaseTitle, "label": map[string]any{"label": profile.Label}, "productType": map[string]any{"label": profile.ProductType}, "descriptionHtml": profile.DescriptionHTML, "searchKeywords": profile.SearchKeywords, "tracklist": profile.Tracklist, "credits": profile.Credits, "pressingNotes": profile.PressingNotes, "merchDetails": profile.MerchDetails, "metadata": profile.Metadata, "artists": artists, "references": references}
		if profile.ReleaseDate != "" {
			body["releaseDate"] = profile.ReleaseDate
		}
		if profile.ReleaseYear != 0 {
			body["releaseYear"] = profile.ReleaseYear
		}
		return c.requestJSON(http.MethodPut, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/profile", body, nil)
	})
}

func (c *client) applyVariantProfiles(profiles []catalogVariantProfile, resolved resolvedCatalog) error {
	return runWorkers(profiles, 8, func(profile catalogVariantProfile) error {
		variant, ok := resolved.variantBySKU[profile.VariantSKU]
		if !ok {
			return fmt.Errorf("variant profile SKU not found: %s", profile.VariantSKU)
		}
		product := resolved.productByHandle[profile.ProductHandle]
		body := map[string]any{"productId": product.ID, "format": map[string]any{"label": profile.Format}, "formatLabel": profile.Format, "displayLabel": profile.DisplayLabel, "preorderAllowed": profile.PreorderAllowed, "backorderAllowed": profile.BackorderAllowed, "metadata": profile.Metadata}
		if profile.FormatDetail != "" {
			body["formatDetail"] = map[string]any{"label": profile.FormatDetail}
			body["formatDetailLabel"] = profile.FormatDetail
		}
		if profile.PreorderReleaseDate != "" {
			body["preorderReleaseDate"] = profile.PreorderReleaseDate
		}
		if profile.BackorderNote != "" {
			body["backorderNote"] = profile.BackorderNote
		}
		if profile.ImageURL != "" {
			body["imageUrl"] = profile.ImageURL
		}
		return c.requestJSON(http.MethodPut, "/admin/catalog/variants/"+url.PathEscape(variant.ID)+"/profile", body, nil)
	})
}

func (c *client) applyMedia(items []catalogMediaItem, resolved resolvedCatalog) error {
	byHandle := map[string][]catalogMediaItem{}
	for _, item := range items {
		byHandle[item.ProductHandle] = append(byHandle[item.ProductHandle], item)
	}
	type group struct {
		Handle string
		Items  []catalogMediaItem
	}
	groups := make([]group, 0, len(byHandle))
	for handle, values := range byHandle {
		groups = append(groups, group{handle, values})
	}
	return runWorkers(groups, 6, func(group group) error {
		product, ok := resolved.productByHandle[group.Handle]
		if !ok {
			return fmt.Errorf("media handle not found: %s", group.Handle)
		}
		media := make([]map[string]any, 0, len(group.Items))
		for _, item := range group.Items {
			payload := map[string]any{"sourceUrl": item.SourceURL, "role": item.Role, "sortOrder": item.SortOrder, "isPrimary": item.IsPrimary, "altText": item.AltText, "derivativeStatus": item.DerivativeStatus, "metadata": item.Metadata}
			if item.VariantSKU != "" {
				variant, ok := resolved.variantBySKU[item.VariantSKU]
				if !ok {
					return fmt.Errorf("media SKU not found: %s", item.VariantSKU)
				}
				payload["variantId"] = variant.ID
			}
			media = append(media, payload)
		}
		return c.requestJSON(http.MethodPut, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/media", map[string]any{"media": media}, nil)
	})
}

func (c *client) applyBundles(bundles []catalogBundleProfile, components []catalogBundleComponent, resolved resolvedCatalog) error {
	byHandle := map[string][]catalogBundleComponent{}
	for _, component := range components {
		byHandle[component.BundleHandle] = append(byHandle[component.BundleHandle], component)
	}
	for _, bundle := range bundles {
		product, ok := resolved.productByHandle[bundle.ProductHandle]
		if !ok {
			return fmt.Errorf("bundle handle not found: %s", bundle.ProductHandle)
		}
		payloadComponents := []map[string]any{}
		for _, component := range byHandle[bundle.ProductHandle] {
			componentProduct, ok := resolved.productByHandle[component.ComponentProductHandle]
			if !ok {
				return fmt.Errorf("component handle not found: %s", component.ComponentProductHandle)
			}
			resolvedMappings := []map[string]any{}
			for _, mapping := range component.VariantMappings {
				bundleIDs := []string{}
				for _, sku := range mapping.BundleVariantSKUs {
					variant, ok := resolved.variantBySKU[sku]
					if !ok {
						return fmt.Errorf("bundle mapping SKU not found: %s", sku)
					}
					bundleIDs = append(bundleIDs, variant.ID)
				}
				componentVariants := []map[string]any{}
				for _, sku := range mapping.ComponentVariantSKUs {
					variant, ok := resolved.variantBySKU[sku]
					if !ok {
						return fmt.Errorf("component mapping SKU not found: %s", sku)
					}
					if len(variant.InventoryItems) == 0 {
						return fmt.Errorf("component mapping SKU has no inventory item: %s", sku)
					}
					componentVariants = append(componentVariants, map[string]any{"variant_id": variant.ID, "inventory_item_id": variant.InventoryItems[0].InventoryItemID, "sku": sku})
				}
				resolvedMappings = append(resolvedMappings, map[string]any{"bundle_variant_ids": bundleIDs, "selection_mode": mapping.SelectionMode, "component_variants": componentVariants})
			}
			firstVariant := resolved.variantBySKU[component.ComponentVariantSKUs[0]]
			metadata := cloneMap(component.Metadata)
			metadata["selection_mode"] = component.SelectionMode
			metadata["component_kind"] = component.ComponentKind
			metadata["component_variant_skus"] = component.ComponentVariantSKUs
			metadata["bundle_variant_skus"] = component.BundleVariantSKUs
			metadata["variant_mappings"] = component.VariantMappings
			metadata["resolved_variant_mappings"] = resolvedMappings
			payloadComponents = append(payloadComponents, map[string]any{"componentProductId": componentProduct.ID, "componentVariantId": firstVariant.ID, "componentInventoryItemId": firstVariant.InventoryItems[0].InventoryItemID, "title": component.Title, "sku": firstVariant.SKU, "quantity": component.Quantity, "sortOrder": component.SortOrder, "isRequired": component.IsRequired, "metadata": metadata})
		}
		body := map[string]any{"bundleType": bundle.BundleType, "inventoryMode": bundle.InventoryMode, "fulfillmentMode": bundle.FulfillmentMode, "displayTitle": bundle.DisplayTitle, "descriptionHtml": bundle.DescriptionHTML, "isActive": bundle.IsActive, "metadata": bundle.Metadata, "components": payloadComponents}
		if err := c.requestJSON(http.MethodPut, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/bundle", body, nil); err != nil {
			return err
		}
	}
	return nil
}

func (c *client) rollback(cfg config) error {
	if cfg.BackupPath == "" {
		return errors.New("rollback requires --backup")
	}
	if cfg.Confirm != applyConfirmation {
		return fmt.Errorf("rollback requires --confirm %s", applyConfirmation)
	}
	var backup importBackup
	if err := readJSON(cfg.BackupPath, &backup); err != nil {
		return err
	}
	if backup.Environment != "staging" || strings.TrimRight(backup.BaseURL, "/") != c.baseURL {
		return errors.New("backup target does not match requested staging target")
	}
	products, err := c.listProducts()
	if err != nil {
		return err
	}
	resolved := resolveProducts(products)
	for _, handle := range backup.CreatedHandles {
		product, ok := resolved.productByHandle[handle]
		if !ok {
			continue
		}
		for _, variant := range product.Variants {
			_ = c.requestJSON(http.MethodDelete, "/admin/catalog/variants/"+url.PathEscape(variant.ID)+"/profile", nil, nil)
		}
		_ = c.requestJSON(http.MethodDelete, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/media", nil, nil)
		_ = c.requestJSON(http.MethodDelete, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/bundle", nil, nil)
		_ = c.requestJSON(http.MethodDelete, "/admin/catalog/products/"+url.PathEscape(product.ID)+"/profile", nil, nil)
		if err := c.requestJSON(http.MethodDelete, "/admin/products/"+url.PathEscape(product.ID), nil, nil); err != nil {
			return err
		}
	}
	artistBefore := toSet(backup.ArtistIDsBefore)
	artists, _ := c.listArtists()
	for _, artist := range artists.Artists {
		if !artistBefore[artist.ID] {
			_ = c.requestJSON(http.MethodDelete, "/admin/catalog/artists/"+url.PathEscape(artist.ID), nil, nil)
		}
	}
	referenceBefore := toSet(backup.ReferenceIDsBefore)
	refs, _ := c.listReferences()
	for _, ref := range refs.Values {
		if !referenceBefore[ref.ID] {
			_ = c.requestJSON(http.MethodDelete, "/admin/catalog/reference-values/"+url.PathEscape(ref.ID), nil, nil)
		}
	}
	fmt.Printf("rollback complete: removed %d products created by import\n", len(backup.CreatedHandles))
	return nil
}

func runWorkers[T any](items []T, workers int, fn func(T) error) error {
	jobs := make(chan T)
	errCh := make(chan error, 1)
	var wg sync.WaitGroup
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				case item, ok := <-jobs:
					if !ok {
						return
					}
					if err := fn(item); err != nil {
						select {
						case errCh <- err:
							cancel()
						default:
						}
						return
					}
				}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, item := range items {
			select {
			case <-ctx.Done():
				return
			case jobs <- item:
			}
		}
	}()
	wg.Wait()
	select {
	case err := <-errCh:
		return err
	default:
		return nil
	}
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func idsFromArtists(response artistListResponse) []string {
	result := []string{}
	for _, value := range response.Artists {
		result = append(result, value.ID)
	}
	sort.Strings(result)
	return result
}
func idsFromReferences(response referenceListResponse) []string {
	result := []string{}
	for _, value := range response.Values {
		result = append(result, value.ID)
	}
	sort.Strings(result)
	return result
}
func toSet(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		result[value] = true
	}
	return result
}
func cloneMap(value map[string]any) map[string]any {
	result := map[string]any{}
	for key, entry := range value {
		result[key] = entry
	}
	return result
}
func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
