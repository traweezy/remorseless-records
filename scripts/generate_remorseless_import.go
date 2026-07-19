package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	defaultSourcePath          = "tmp/remorseless_current_products.jsonl"
	defaultCurrentURLsPath     = "tmp/remorseless_current_product_urls.txt"
	defaultCleanedCsvPath      = "tmp/phase6-cleaned-source.csv"
	defaultUploaderCsvPath     = "tmp/phase6-uploader-ready.csv"
	defaultNormalizedJsonPath  = "tmp/phase6-normalized-products.json"
	defaultCatalogJsonPath     = "tmp/phase6-catalog-upserts.json"
	defaultInventoryCsvPath    = "tmp/phase6-inventory-levels.csv"
	defaultAmbiguitiesCsvPath  = "tmp/phase6-ambiguities.csv"
	defaultPreviewJsonPath     = "tmp/phase6-import-preview.json"
	defaultReadmePath          = "tmp/phase6-import-contract.md"
	defaultCurrencyCode        = "USD"
	defaultLabel               = "Remorseless Records"
	defaultAvailableStock      = 20
	defaultLowStock            = 2
	defaultPreorderStock       = 50
	defaultManualBundleStock   = 10
	phase6ImportMetadataSchema = "remorseless_phase6_import_v1"
	privateYogyakartaKitHandle = "internal-inventory-special-region-yogyakarta-numbered-kit"
	privateYogyakartaKitSKU    = "INTERNAL_SPECIAL_REGION_YOGYAKARTA_NUMBERED_KIT"
)

var (
	formatSuffixRegex     = regexp.MustCompile(`(?i)\s*-\s*((?:[234]?\s*(?:lp|cd)\s*box\s*set|[234]?\s*(?:lp|cd)|mc|cassette|tape|vinyl|dvd|7"|12"|boxset|bundle|cd bundle|ep bundle|3lp|3cd)(?:\s*,\s*(?:[234]?\s*(?:lp|cd)\s*box\s*set|[234]?\s*(?:lp|cd)|mc|cassette|tape|vinyl|dvd|7"|12"|boxset|bundle|cd bundle|ep bundle|3lp|3cd))*)\s*$`)
	firstTitleSplitRegex  = regexp.MustCompile(`\s+-\s*`)
	preorderRegex         = regexp.MustCompile(`(?i)\bpre[-\s]?order\b`)
	backorderRegex        = regexp.MustCompile(`(?i)\bback[-\s]?order\b`)
	bundleRegex           = regexp.MustCompile(`(?i)\b(bundle|bundles|deal|pack)\b`)
	mysteryBundleRegex    = regexp.MustCompile(`(?i)\bmystery\b`)
	discographyRegex      = regexp.MustCompile(`(?i)\bdiscography\b`)
	multiUnitFormatRegex  = regexp.MustCompile(`(?i)^([2-9][0-9]*)\s*(cd|lp)(?:\s*(box\s*set))?$`)
	htmlTagRegex          = regexp.MustCompile(`<[^>]+>`)
	whitespaceRegex       = regexp.MustCompile(`\s+`)
	explicitMonthDayRegex = regexp.MustCompile(`(?i)\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b`)
	endOfMonthRegex       = regexp.MustCompile(`(?i)\bend\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b`)
	latinSlugReplacer     = strings.NewReplacer(
		"à", "a", "á", "a", "â", "a", "ã", "a", "ä", "a", "å", "a", "æ", "ae",
		"ç", "c",
		"è", "e", "é", "e", "ê", "e", "ë", "e",
		"ì", "i", "í", "i", "î", "i", "ï", "i",
		"ð", "d",
		"ñ", "n",
		"ò", "o", "ó", "o", "ô", "o", "õ", "o", "ö", "o", "ø", "o", "œ", "oe",
		"ù", "u", "ú", "u", "û", "u", "ü", "u",
		"ý", "y", "ÿ", "y",
		"þ", "th", "ß", "ss", "ł", "l",
	)
	reviewedPriceEstimates = map[string]reviewedPriceEstimate{
		"107775027|CD": {
			PriceUSDCents: 1000,
			Basis:         "Closest short-run goregrind CD peers are $9-$11; use the midpoint.",
		},
		"107775027|Cassette": {
			PriceUSDCents: 800,
			Basis:         "Comparable CD/cassette releases commonly price the cassette $2-$4 below the CD; current cassette median is $8.",
		},
		"110427429|Vinyl": {
			PriceUSDCents: 2000,
			Basis:         "Nearby November 2024 death-metal LP listings are $18-$23; use $20 for the standard LP.",
		},
		"110427654|Cassette": {
			PriceUSDCents: 800,
			Basis:         "Comparable death-metal demo cassettes cluster at $8-$10; use the current cassette median.",
		},
		"110427654|Vinyl": {
			PriceUSDCents: 2000,
			Basis:         "Comparable death-metal demo LPs cluster at $20-$23; use the conservative end for this demo reissue.",
		},
		"111176526|CD": {
			PriceUSDCents: 1200,
			Basis:         "Brodequin's Methods of Execution CD in the same listing series is $12.",
		},
		"111176538|CD": {
			PriceUSDCents: 1200,
			Basis:         "Brodequin's Methods of Execution CD in the same listing series is $12.",
		},
		"111176724|CD": {
			PriceUSDCents: 2000,
			Basis:         "Comparable 2CD anthologies and complete-recording sets are $18-$20; this 31-track set includes a 20-page booklet.",
		},
		"111176733|CD": {
			PriceUSDCents: 1300,
			Basis:         "A cached Remorseless listing supports $13 for this slipcase CD.",
		},
		"111176748|CD": {
			PriceUSDCents: 1200,
			Basis:         "Malevolent Creation's adjacent In Cold Blood and The Fine Art of Murder CD listings are both $12.",
		},
		"113743212|CD": {
			PriceUSDCents: 1300,
			Basis:         "The closest June 2025 death-metal CD listings in the same source batch cluster at $12-$13.",
		},
		"113743365|CD": {
			PriceUSDCents: 1300,
			Basis:         "Adjacent June 2025 special-edition death-metal CDs are $13, including both neighboring source listings.",
		},
	}
	reviewedBundleDefinitions = map[string]reviewedBundleDefinition{
		"fixed-bundle-blunt-knife-castration-3-cd-bundle": {
			Artists: []string{"Blunt Knife Castration"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-blunt-knife-castration-chewed-up-and-spat-out", DisplayTitle: "Blunt Knife Castration — Chewed Up and Spat Out", FormatLabel: "CD"},
				{ProductHandle: "music-release-blunt-knife-castration-live-fast-die-slow", DisplayTitle: "Blunt Knife Castration — Live Fast Die Slow", FormatLabel: "CD"},
				{ProductHandle: "music-release-blunt-knife-castration-blood-oil", DisplayTitle: "Blunt Knife Castration — Blood & Oil", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-concrete-winds-discography-bundle-3lp-3cd": {
			Artists: []string{"Concrete Winds"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-concrete-winds-concrete-winds", DisplayTitle: "Concrete Winds — Concrete Winds", FormatMappings: cdAndVinylBundleMappings()},
				{ProductHandle: "music-release-concrete-winds-nerve-butcherer", DisplayTitle: "Concrete Winds — Nerve Butcherer", FormatMappings: cdAndVinylBundleMappings()},
				{ProductHandle: "music-release-concrete-winds-primitive-force", DisplayTitle: "Concrete Winds — Primitive Force", FormatMappings: cdAndVinylBundleMappings()},
			},
		},
		"fixed-bundle-cultus-sanguine-2-cd-bundle": {
			Artists: []string{"Cultus Sanguine"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-cultus-sanguine-shadow-s-blood", DisplayTitle: "Cultus Sanguine — Shadow's Blood", FormatLabel: "CD"},
				{ProductHandle: "music-release-cultus-sanguine-the-sum-of-all-fears", DisplayTitle: "Cultus Sanguine — The Sum of All Fears", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-death-thrash-attack": {
			Artists: []string{"Savage Ruins", "Force of Darkness", "Sijjin"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-savage-ruins-world-in-wrath", DisplayTitle: "Savage Ruins — World in Wrath", FormatLabel: "CD"},
				{ProductHandle: "music-release-force-of-darkness-heritage-of-dark-incantations", DisplayTitle: "Force of Darkness — Heritage of Dark Incantations", FormatLabel: "CD"},
				{ProductHandle: "music-release-sijjin-helljjin-combat", DisplayTitle: "Sijjin — Helljjin Combat", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-demo-tape-bundle": {
			Artists: []string{"Ritual Execution", "Taxidermia", "Envoys", "Jagadjagal"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-ritual-execution-demo-2024", DisplayTitle: "Ritual Execution — Demo 2024", FormatLabel: "Cassette"},
				{ProductHandle: "music-release-taxidermia-demo-2023", DisplayTitle: "Taxidermia — Demo 2023", FormatLabel: "Cassette", FormatDetails: []string{"White Shell", "Red Shell"}, SelectionMode: "any"},
				{ProductHandle: "music-release-envoys-glimpse-beyond-the-veil", DisplayTitle: "Envoys — Glimpse Beyond the Veil", FormatLabel: "Cassette"},
				{ProductHandle: "music-release-jagadjagal-demo-mmxxiv", DisplayTitle: "Jagadjagal — Demo MMXXIV", FormatLabel: "Cassette"},
			},
		},
		"fixed-bundle-devoured-death-bundle": {
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "merch-devoured-death-5", DisplayTitle: "Devoured Death #5", FormatLabel: "Standard"},
				{ProductHandle: "merch-devoured-death-666", DisplayTitle: "Devoured Death #666", FormatLabel: "Standard"},
				{ProductHandle: "merch-devoured-death-7", DisplayTitle: "Devoured Death #7", FormatLabel: "Standard"},
			},
		},
		"fixed-bundle-ectoplasma-2-ep-bundle": {
			Artists: []string{"Ectoplasma"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-ectoplasma-skeletal-lifeforms", DisplayTitle: "Ectoplasma — Skeletal Lifeforms", FormatLabel: "CD"},
				{ProductHandle: "music-release-ectoplasma-cryogenically-revived", DisplayTitle: "Ectoplasma — Cryogenically Revived", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-fulci-discography-bundle": {
			Artists: []string{"Fulci"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-fulci-opening-the-gates-of-hell", DisplayTitle: "Fulci — Opening the Gates of Hell", FormatLabel: "CD"},
				{ProductHandle: "music-release-fulci-tropical-sun", DisplayTitle: "Fulci — Tropical Sun", FormatLabel: "CD"},
				{ProductHandle: "music-release-fulci-exhumed-information", DisplayTitle: "Fulci — Exhumed Information", FormatLabel: "CD"},
				{ProductHandle: "music-release-fulci-duck-face-killings", DisplayTitle: "Fulci — Duck Face Killings", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-houwitser-cd-bundle": {
			Artists: []string{"Houwitser"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-houwitser-rage-inside-the-womb", DisplayTitle: "Houwitser — Rage Inside the Womb", FormatLabel: "CD"},
				{ProductHandle: "music-release-houwitser-damage-assessment", DisplayTitle: "Houwitser — Damage Assessment", FormatLabel: "CD"},
				{ProductHandle: "music-release-houwitser-sentinel-beast", DisplayTitle: "Houwitser — Sentinel Beast", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-old-school-tape-bundle": {
			Artists: []string{"Masacre", "Wombbath", "Utumno"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-masacre-barbarie-y-sangre-en-memoria-de-cristo", DisplayTitle: "Masacre — Barbarie y Sangre en Memoria de Cristo", FormatLabel: "Cassette"},
				{ProductHandle: "music-release-wombbath-brutal-mights-several-shapes", DisplayTitle: "Wombbath — Brutal Mights / Several Shapes", FormatLabel: "Cassette"},
				{ProductHandle: "music-release-utumno-across-the-horizon", DisplayTitle: "Utumno — Across the Horizon", FormatLabel: "Cassette"},
			},
		},
		"fixed-bundle-pissgrave-discography-bundle": {
			Artists: []string{"Pissgrave"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-pissgrave-suicide-euphoria", DisplayTitle: "Pissgrave — Suicide Euphoria", FormatLabel: "CD"},
				{ProductHandle: "music-release-pissgrave-posthumous-humiliation", DisplayTitle: "Pissgrave — Posthumous Humiliation", FormatLabel: "CD"},
				{ProductHandle: "music-release-pissgrave-malignant-worthlessness", DisplayTitle: "Pissgrave — Malignant Worthlessness", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-repugnance-complete-works-bundle": {
			Artists: []string{"Repugnance"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-repugnance-perpetual-deviousness-vol-1", DisplayTitle: "Repugnance — Perpetual Deviousness Vol. 1", FormatLabel: "CD"},
				{ProductHandle: "music-release-repugnance-perpetual-deviousness-vol-2", DisplayTitle: "Repugnance — Perpetual Deviousness Vol. 2", FormatLabel: "CD"},
				{ProductHandle: "music-release-repugnance-retrieving-dead-bodies", DisplayTitle: "Repugnance — Retrieving Dead Bodies", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-siamese-brutalism-bundle": {
			Artists: []string{"Reincarnated", "Savage Deity", "Oldskull", "Smallpox Aroma"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-reincarnated-of-bootes-void-death-spell", DisplayTitle: "Reincarnated — Of Boötes Void Death Spell", FormatLabel: "CD"},
				{ProductHandle: "music-release-savage-deity-decade-of-savagery", DisplayTitle: "Savage Deity — Decade of Savagery", FormatLabel: "CD"},
				{ProductHandle: "music-release-oldskull-nether-hollow-of-no-return", DisplayTitle: "Oldskull — Nether Hollow of No Return", FormatLabel: "CD"},
				{ProductHandle: "music-release-smallpox-aroma-festering-embryos-of-logical-corruption", DisplayTitle: "Smallpox Aroma — Festering Embryos of Logical Corruption", FormatLabel: "CD"},
			},
		},
		"fixed-bundle-special-region-of-yogyakarta-bundle": {
			Artists:              []string{"Jagadjagal", "Drain Death"},
			IncludedPackageItems: []string{"Numbered drawstring bag", "Stickers", "Pin", "Download codes"},
			Components: []reviewedBundleComponentDefinition{
				{ProductHandle: "music-release-jagadjagal-demo-mmxxiv", DisplayTitle: "Jagadjagal — Demo MMXXIV", FormatLabel: "Cassette"},
				{ProductHandle: "music-release-drain-death-merciless-of-doom", DisplayTitle: "Drain Death — Merciless Of Doom", FormatLabel: "Cassette"},
				{ProductHandle: privateYogyakartaKitHandle, DisplayTitle: "Numbered drawstring bag kit", FormatLabel: "Standard", ComponentKind: "private_inventory_kit"},
			},
		},
	}
)

type reviewedPriceEstimate struct {
	PriceUSDCents int
	Basis         string
}

type reviewedBundleDefinition struct {
	Artists              []string
	IncludedPackageItems []string
	Components           []reviewedBundleComponentDefinition
}

type reviewedBundleComponentDefinition struct {
	ProductHandle     string
	DisplayTitle      string
	FormatLabel       string
	FormatDetails     []string
	BundleFormatLabel string
	SelectionMode     string
	ComponentKind     string
	FormatMappings    []reviewedBundleFormatMapping
}

type reviewedBundleFormatMapping struct {
	ComponentFormatLabel   string
	ComponentFormatDetails []string
	BundleFormatLabel      string
	SelectionMode          string
}

type sourceRecord struct {
	Line                  int
	ProductID             string
	ProductName           string
	ProductPermalink      string
	ProductURL            string
	DetailURL             string
	CreatedAt             string
	Status                string
	Currency              string
	DefaultPrice          float64
	Price                 float64
	Description           string
	DescriptionHTML       string
	BrandName             string
	Categories            []sourceCategory
	Options               []sourceOption
	Images                []sourceImage
	GalleryURLs           []string
	RawCategoryNames      string
	RawCategoryPermalinks string
}

type sourceCategory struct {
	ID        json.RawMessage `json:"id"`
	Name      string          `json:"name"`
	Permalink string          `json:"permalink"`
	URL       string          `json:"url"`
}

type sourceOption struct {
	ID              json.RawMessage `json:"id"`
	Name            string          `json:"name"`
	Price           float64         `json:"price"`
	SoldOut         bool            `json:"sold_out"`
	IsLowInventory  bool            `json:"isLowInventory"`
	IsAlmostSoldOut bool            `json:"isAlmostSoldOut"`
}

type sourceImage struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type bigCartelProduct struct {
	ID                    json.RawMessage  `json:"id"`
	Name                  string           `json:"name"`
	Permalink             string           `json:"permalink"`
	URL                   string           `json:"url"`
	CreatedAt             string           `json:"created_at"`
	Status                string           `json:"status"`
	Price                 float64          `json:"price"`
	DefaultPrice          float64          `json:"default_price"`
	Description           string           `json:"description"`
	Categories            []sourceCategory `json:"categories"`
	Options               []sourceOption   `json:"options"`
	Images                []sourceImage    `json:"images"`
	HasOptionGroups       bool             `json:"has_option_groups"`
	HasPasswordProtection bool             `json:"has_password_protection"`
}

type parsedIdentity struct {
	ArtistNames    []string `json:"artist_names"`
	ReleaseTitle   string   `json:"release_title"`
	FormatSuffix   string   `json:"format_suffix,omitempty"`
	Confidence     string   `json:"confidence"`
	AmbiguityCodes []string `json:"ambiguity_codes,omitempty"`
}

type normalizedVariant struct {
	SourceProductID     string         `json:"source_product_id"`
	SourceOptionID      string         `json:"source_option_id,omitempty"`
	SourceOptionName    string         `json:"source_option_name"`
	DisplayLabel        string         `json:"display_label"`
	FormatLabel         string         `json:"format_label"`
	FormatDetailLabel   string         `json:"format_detail_label,omitempty"`
	SKU                 string         `json:"sku"`
	PriceUSDCents       int            `json:"price_usd_cents"`
	SourceSoldOut       bool           `json:"source_sold_out"`
	SourceLowInventory  bool           `json:"source_low_inventory"`
	SeedInventory       int            `json:"seed_inventory_quantity"`
	ManageInventory     bool           `json:"manage_inventory"`
	AllowBackorder      bool           `json:"allow_backorder"`
	PreorderAllowed     bool           `json:"preorder_allowed"`
	PreorderReleaseDate string         `json:"preorder_release_date,omitempty"`
	BackorderAllowed    bool           `json:"backorder_allowed"`
	BackorderNote       string         `json:"backorder_note,omitempty"`
	ImageURL            string         `json:"image_url,omitempty"`
	Metadata            map[string]any `json:"metadata"`
	AmbiguityCodes      []string       `json:"ambiguity_codes,omitempty"`
}

type normalizedProduct struct {
	SourceProductIDs []string            `json:"source_product_ids"`
	SourceURLs       []string            `json:"source_urls"`
	SourceNames      []string            `json:"source_names"`
	Handle           string              `json:"handle"`
	Title            string              `json:"title"`
	ProductType      string              `json:"product_type"`
	Status           string              `json:"status"`
	Label            string              `json:"label"`
	Artists          []string            `json:"artists"`
	Genres           []string            `json:"genres"`
	UtilityTags      []string            `json:"utility_tags"`
	SearchKeywords   []string            `json:"search_keywords"`
	DescriptionText  string              `json:"description_text"`
	DescriptionHTML  string              `json:"description_html"`
	ReleaseDate      string              `json:"release_date,omitempty"`
	ReleaseYear      int                 `json:"release_year,omitempty"`
	Images           []string            `json:"images"`
	Variants         []normalizedVariant `json:"variants"`
	Bundle           *bundlePlan         `json:"bundle,omitempty"`
	SourceCategories []string            `json:"source_categories"`
	Identity         parsedIdentity      `json:"identity"`
	Metadata         map[string]any      `json:"metadata"`
	AmbiguityCodes   []string            `json:"ambiguity_codes,omitempty"`
}

type bundlePlan struct {
	BundleType           string                     `json:"bundle_type"`
	InventoryMode        string                     `json:"inventory_mode"`
	FulfillmentMode      string                     `json:"fulfillment_mode"`
	IncludedPackageItems []string                   `json:"included_package_items,omitempty"`
	ComponentCandidates  []bundleComponentCandidate `json:"component_candidates,omitempty"`
	RequiresReview       bool                       `json:"requires_review"`
	ReviewReason         string                     `json:"review_reason,omitempty"`
}

type bundleComponentCandidate struct {
	Handle               string                          `json:"handle"`
	Title                string                          `json:"title"`
	Artist               string                          `json:"artist,omitempty"`
	Quantity             int                             `json:"quantity"`
	FormatLabel          string                          `json:"format_label,omitempty"`
	FormatDetails        []string                        `json:"format_details,omitempty"`
	BundleFormatLabel    string                          `json:"bundle_format_label,omitempty"`
	ComponentVariantSKUs []string                        `json:"component_variant_skus,omitempty"`
	BundleVariantSKUs    []string                        `json:"bundle_variant_skus,omitempty"`
	SelectionMode        string                          `json:"selection_mode"`
	ComponentKind        string                          `json:"component_kind"`
	VariantMappings      []bundleComponentVariantMapping `json:"variant_mappings"`
	mappingDefinitions   []reviewedBundleFormatMapping
}

type bundleComponentVariantMapping struct {
	BundleVariantSKUs    []string `json:"bundle_variant_skus"`
	ComponentVariantSKUs []string `json:"component_variant_skus"`
	SelectionMode        string   `json:"selection_mode"`
}

type importPreview struct {
	GeneratedAt                   string            `json:"generated_at"`
	SourcePath                    string            `json:"source_path"`
	CurrentURLsPath               string            `json:"current_urls_path"`
	SalesChannelID                string            `json:"sales_channel_id,omitempty"`
	SourceProductCount            int               `json:"source_product_count"`
	CurrentListingCount           int               `json:"current_listing_count"`
	ExcludedUnlistedSourceCount   int               `json:"excluded_unlisted_source_count"`
	NormalizedProductCount        int               `json:"normalized_product_count"`
	UploaderRowCount              int               `json:"uploader_row_count"`
	VariantCount                  int               `json:"variant_count"`
	BundleCount                   int               `json:"bundle_count"`
	FixedBundleCount              int               `json:"fixed_bundle_count"`
	MysteryBundleCount            int               `json:"mystery_bundle_count"`
	ReviewedFixedBundleCount      int               `json:"reviewed_fixed_bundle_count"`
	BundleComponentCount          int               `json:"bundle_component_requirement_count"`
	InternalInventoryProductCount int               `json:"internal_inventory_product_count"`
	MerchCount                    int               `json:"merch_count"`
	MusicReleaseCount             int               `json:"music_release_count"`
	ArtistCount                   int               `json:"artist_count"`
	GenreCount                    int               `json:"genre_count"`
	UtilityTagCount               int               `json:"utility_tag_count"`
	MediaURLCount                 int               `json:"media_url_count"`
	SoldOutVariantCount           int               `json:"sold_out_variant_count"`
	LowInventoryVariantCount      int               `json:"low_inventory_variant_count"`
	PreorderProductCount          int               `json:"preorder_product_count"`
	BackorderEligibleVariantCount int               `json:"backorder_eligible_variant_count"`
	ReviewedPriceEstimateCount    int               `json:"reviewed_price_estimate_variant_count"`
	SeedInventoryTotal            int               `json:"seed_inventory_total"`
	AmbiguityCount                int               `json:"ambiguity_count"`
	AmbiguityCounts               map[string]int    `json:"ambiguity_counts"`
	Warnings                      []string          `json:"warnings"`
	OutputFiles                   map[string]string `json:"output_files"`
	SHA256                        map[string]string `json:"sha256"`
	HeaderContract                []string          `json:"header_contract"`
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
	Notes            []string                 `json:"notes"`
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

type catalogProductProfile struct {
	ProductHandle   string         `json:"product_handle"`
	ReleaseTitle    string         `json:"release_title"`
	Label           string         `json:"label"`
	ProductType     string         `json:"product_type"`
	ReleaseDate     string         `json:"release_date,omitempty"`
	ReleaseYear     int            `json:"release_year,omitempty"`
	DescriptionHTML string         `json:"description_html"`
	SearchKeywords  []string       `json:"search_keywords"`
	Artists         []string       `json:"artists"`
	References      []profileRef   `json:"references"`
	Tracklist       []any          `json:"tracklist"`
	Credits         map[string]any `json:"credits"`
	PressingNotes   map[string]any `json:"pressing_notes"`
	MerchDetails    map[string]any `json:"merch_details"`
	Metadata        map[string]any `json:"metadata"`
}

type profileRef struct {
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	SortOrder int    `json:"sort_order"`
}

type catalogVariantProfile struct {
	ProductHandle       string         `json:"product_handle"`
	VariantSKU          string         `json:"variant_sku"`
	Format              string         `json:"format"`
	FormatDetail        string         `json:"format_detail,omitempty"`
	DisplayLabel        string         `json:"display_label"`
	PreorderAllowed     bool           `json:"preorder_allowed"`
	PreorderReleaseDate string         `json:"preorder_release_date,omitempty"`
	BackorderAllowed    bool           `json:"backorder_allowed"`
	BackorderNote       string         `json:"backorder_note,omitempty"`
	ImageURL            string         `json:"image_url,omitempty"`
	Metadata            map[string]any `json:"metadata"`
}

type catalogMediaItem struct {
	ProductHandle    string         `json:"product_handle"`
	VariantSKU       string         `json:"variant_sku,omitempty"`
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
	RequiresReview  bool           `json:"requires_review"`
	ReviewReason    string         `json:"review_reason,omitempty"`
	Metadata        map[string]any `json:"metadata"`
}

type catalogBundleComponent struct {
	BundleHandle           string                          `json:"bundle_handle"`
	ComponentProductHandle string                          `json:"component_product_handle"`
	ComponentVariantSKUs   []string                        `json:"component_variant_skus"`
	BundleVariantSKUs      []string                        `json:"bundle_variant_skus"`
	Title                  string                          `json:"title"`
	Quantity               int                             `json:"quantity"`
	SortOrder              int                             `json:"sort_order"`
	IsRequired             bool                            `json:"is_required"`
	SelectionMode          string                          `json:"selection_mode"`
	ComponentKind          string                          `json:"component_kind"`
	VariantMappings        []bundleComponentVariantMapping `json:"variant_mappings"`
	NeedsResolution        bool                            `json:"needs_resolution"`
	Metadata               map[string]any                  `json:"metadata"`
}

func main() {
	sourcePath := flag.String("source", defaultSourcePath, "source JSONL scrape path")
	currentURLsPath := flag.String("current-urls", defaultCurrentURLsPath, "current live product URL list")
	cleanedCsvPath := flag.String("cleaned-csv", defaultCleanedCsvPath, "normalized review CSV output path")
	uploaderCsvPath := flag.String("uploader-csv", defaultUploaderCsvPath, "Medusa uploader CSV output path")
	normalizedJsonPath := flag.String("normalized-json", defaultNormalizedJsonPath, "normalized product JSON output path")
	catalogJsonPath := flag.String("catalog-json", defaultCatalogJsonPath, "catalog upsert artifact output path")
	inventoryCsvPath := flag.String("inventory-csv", defaultInventoryCsvPath, "inventory level artifact output path")
	ambiguitiesCsvPath := flag.String("ambiguities-csv", defaultAmbiguitiesCsvPath, "ambiguity report CSV output path")
	previewJsonPath := flag.String("preview-json", defaultPreviewJsonPath, "import preview JSON output path")
	readmePath := flag.String("readme", defaultReadmePath, "import contract markdown output path")
	defaultSalesChannelID := flag.String("sales-channel-id", strings.TrimSpace(os.Getenv("MEDUSA_DEFAULT_SALES_CHANNEL_ID")), "optional Medusa sales channel ID for Product Sales Channel 1")
	flag.Parse()

	records, err := readSourceRecords(*sourcePath)
	must(err)
	currentURLs, err := readLineSet(*currentURLsPath)
	must(err)
	if len(currentURLs) == 0 {
		must(fmt.Errorf("current product URL list %s is empty", *currentURLsPath))
	}
	records, excludedUnlistedSourceCount, err := filterCurrentSourceRecords(records, currentURLs)
	must(err)
	products, err := normalizeProducts(records)
	must(err)
	ensureUniqueHandles(products)
	ensureUniqueSKUs(products)

	preview := buildPreview(
		*sourcePath,
		*currentURLsPath,
		currentURLs,
		excludedUnlistedSourceCount,
		products,
		*defaultSalesChannelID,
	)
	paths := map[string]string{
		"cleaned_source_csv": *cleanedCsvPath,
		"uploader_csv":       *uploaderCsvPath,
		"normalized_json":    *normalizedJsonPath,
		"catalog_json":       *catalogJsonPath,
		"inventory_csv":      *inventoryCsvPath,
		"ambiguities_csv":    *ambiguitiesCsvPath,
		"preview_json":       *previewJsonPath,
		"contract_markdown":  *readmePath,
	}
	preview.OutputFiles = paths

	must(writeCleanedSourceCSV(*cleanedCsvPath, products))
	must(writeUploaderCSV(*uploaderCsvPath, products, *defaultSalesChannelID))
	must(writeJSON(*normalizedJsonPath, products))
	must(writeJSON(*catalogJsonPath, buildCatalogArtifact(products)))
	must(writeInventoryCSV(*inventoryCsvPath, products))
	must(writeAmbiguitiesCSV(*ambiguitiesCsvPath, products))
	must(writeContractMarkdown(*readmePath, preview))

	hashes := map[string]string{}
	for key, path := range paths {
		if key == "preview_json" {
			continue
		}
		hash, err := sha256File(path)
		must(err)
		hashes[key] = hash
	}
	preview.SHA256 = hashes
	must(writeJSON(*previewJsonPath, preview))

	fmt.Printf("Generated %d normalized products from %d source products\n", preview.NormalizedProductCount, preview.SourceProductCount)
	fmt.Printf("Uploader rows: %d, variants: %d, bundles: %d, ambiguities: %d\n", preview.UploaderRowCount, preview.VariantCount, preview.BundleCount, preview.AmbiguityCount)
	for key, path := range paths {
		fmt.Printf("%s: %s\n", key, path)
	}
}

func readSourceRecords(path string) ([]sourceRecord, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var records []sourceRecord
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024*1024), 20*1024*1024)
	line := 0
	for scanner.Scan() {
		line++
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		var raw map[string]any
		if err := json.Unmarshal([]byte(text), &raw); err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		record, err := sourceRecordFromRaw(line, raw)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

func readLineSet(path string) (map[string]bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := map[string]bool{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		value := strings.TrimSpace(scanner.Text())
		if value != "" {
			values[value] = true
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func filterCurrentSourceRecords(
	records []sourceRecord,
	currentURLs map[string]bool,
) ([]sourceRecord, int, error) {
	filtered := make([]sourceRecord, 0, len(currentURLs))
	foundURLs := map[string]bool{}
	for _, record := range records {
		if !currentURLs[record.DetailURL] {
			continue
		}
		filtered = append(filtered, record)
		foundURLs[record.DetailURL] = true
	}

	missingURLs := make([]string, 0)
	for currentURL := range currentURLs {
		if !foundURLs[currentURL] {
			missingURLs = append(missingURLs, currentURL)
		}
	}
	if len(missingURLs) > 0 {
		sort.Strings(missingURLs)
		return nil, 0, fmt.Errorf(
			"current URL list contains %d products missing from source data; first missing URL: %s",
			len(missingURLs),
			missingURLs[0],
		)
	}

	return filtered, len(records) - len(filtered), nil
}

func sourceRecordFromRaw(line int, raw map[string]any) (sourceRecord, error) {
	record := sourceRecord{Line: line}
	var bc bigCartelProduct
	if rawValue := stringFromAny(raw["bigcartel_product_json"]); rawValue != "" {
		if err := json.Unmarshal([]byte(rawValue), &bc); err != nil {
			return record, fmt.Errorf("invalid bigcartel_product_json: %w", err)
		}
	}

	record.ProductID = rawIDToString(firstNonEmptyRaw(bc.ID, raw["product_id"]))
	record.ProductName = firstNonEmptyString(bc.Name, stringFromAny(raw["product_name"]), stringFromAny(raw["listing_name"]))
	record.ProductPermalink = firstNonEmptyString(bc.Permalink, stringFromAny(raw["product_permalink"]))
	record.ProductURL = firstNonEmptyString(urlFromPath(bc.URL), stringFromAny(raw["product_url"]))
	record.DetailURL = firstNonEmptyString(stringFromAny(raw["detail_url"]), record.ProductURL)
	record.CreatedAt = firstNonEmptyString(bc.CreatedAt, stringFromAny(raw["created_at"]))
	record.Status = firstNonEmptyString(bc.Status, stringFromAny(raw["product_status"]))
	record.Currency = strings.ToUpper(firstNonEmptyString(stringFromAny(raw["currency"]), defaultCurrencyCode))
	record.DefaultPrice = firstNonZeroFloat(bc.DefaultPrice, floatFromAny(raw["default_price"]), bc.Price, floatFromAny(raw["price"]))
	record.Price = firstNonZeroFloat(bc.Price, floatFromAny(raw["price"]), record.DefaultPrice)
	record.Description = firstNonEmptyString(bc.Description, stringFromAny(raw["description"]))
	record.DescriptionHTML = firstNonEmptyString(stringFromAny(raw["description_html"]), textToHTML(record.Description))
	record.BrandName = firstNonEmptyString(stringFromAny(raw["brand_name"]), defaultLabel)
	record.Categories = firstNonEmptyCategories(bc.Categories, parseCategories(stringFromAny(raw["categories_json"])))
	record.Options = firstNonEmptyOptions(bc.Options, parseOptions(stringFromAny(raw["options_json"])))
	record.Images = firstNonEmptyImages(bc.Images, parseImages(stringFromAny(raw["product_images_json"])))
	record.GalleryURLs = parseStringList(stringFromAny(raw["gallery_urls_json"]))
	record.RawCategoryNames = stringFromAny(raw["category_names"])
	record.RawCategoryPermalinks = stringFromAny(raw["category_permalinks"])
	if record.ProductName == "" {
		return record, errors.New("missing product name")
	}
	if record.ProductID == "" {
		record.ProductID = fmt.Sprintf("line-%d", line)
	}
	return record, nil
}

func normalizeProducts(records []sourceRecord) ([]normalizedProduct, error) {
	groups := map[string]*normalizedProduct{}
	groupOrder := []string{}
	for _, record := range records {
		identity := parseIdentity(record)
		productType := classifyProductType(record, identity)
		identity = identityForProductType(identity, productType)
		key := productGroupingKey(productType, identity, record)
		product := groups[key]
		if product == nil {
			product = &normalizedProduct{
				SourceProductIDs: []string{},
				SourceURLs:       []string{},
				SourceNames:      []string{},
				Handle:           slugify(key, "product"),
				Title:            displayProductTitle(productType, identity, record),
				ProductType:      productType,
				Status:           productStatus(identity),
				Label:            defaultLabel,
				Artists:          identity.ArtistNames,
				Genres:           genresFromCategories(record.Categories),
				UtilityTags:      utilityTagsFromRecord(record, productType),
				SearchKeywords:   searchKeywordsFromRecord(record, identity),
				DescriptionText:  normalizeDescriptionText(record.Description),
				DescriptionHTML:  normalizeDescriptionHTML(record.DescriptionHTML, record.Description),
				ReleaseDate:      preorderReleaseDate(record),
				Images:           imageURLs(record),
				SourceCategories: categoryNames(record.Categories),
				Identity:         identity,
				Metadata: map[string]any{
					"schema":                phase6ImportMetadataSchema,
					"source":                "bigcartel_scrape",
					"source_created_at":     record.CreatedAt,
					"source_brand_name":     record.BrandName,
					"source_category_names": categoryNames(record.Categories),
				},
				AmbiguityCodes: append([]string{}, identity.AmbiguityCodes...),
			}
			if product.ReleaseDate != "" {
				if year := releaseYear(product.ReleaseDate); year > 0 {
					product.ReleaseYear = year
				}
			}
			groups[key] = product
			groupOrder = append(groupOrder, key)
		}

		product.SourceProductIDs = appendUnique(product.SourceProductIDs, record.ProductID)
		if record.DetailURL != "" {
			product.SourceURLs = appendUnique(product.SourceURLs, record.DetailURL)
		}
		product.SourceNames = appendUnique(product.SourceNames, record.ProductName)
		product.Genres = appendUnique(product.Genres, genresFromCategories(record.Categories)...)
		product.UtilityTags = appendUnique(product.UtilityTags, utilityTagsFromRecord(record, productType)...)
		product.SearchKeywords = appendUnique(product.SearchKeywords, searchKeywordsFromRecord(record, identity)...)
		product.Images = appendUnique(product.Images, imageURLs(record)...)
		product.SourceCategories = appendUnique(product.SourceCategories, categoryNames(record.Categories)...)
		if len(product.DescriptionHTML) < len(record.DescriptionHTML) {
			product.DescriptionHTML = normalizeDescriptionHTML(record.DescriptionHTML, record.Description)
		}
		if len(product.DescriptionText) < len(record.Description) {
			product.DescriptionText = normalizeDescriptionText(record.Description)
		}
		product.Variants = append(product.Variants, variantsFromRecord(record, product, identity, productType)...)
	}

	products := make([]normalizedProduct, 0, len(groupOrder))
	for _, key := range groupOrder {
		product := groups[key]
		sort.Strings(product.Genres)
		sort.Strings(product.UtilityTags)
		product.SearchKeywords = stableUnique(product.SearchKeywords)
		product.Images = stableUnique(product.Images)
		product.SourceCategories = stableUnique(product.SourceCategories)
		product.AmbiguityCodes = stableUnique(product.AmbiguityCodes)
		product.Variants = dedupeVariants(product.Variants)
		if product.ProductType == "fixed_bundle" || product.ProductType == "mystery_bundle" {
			product.Bundle = buildBundlePlan(product, records)
			if product.Bundle.RequiresReview {
				product.AmbiguityCodes = appendUnique(product.AmbiguityCodes, "bundle_component_review")
			}
		}
		if len(product.AmbiguityCodes) > 0 {
			product.Status = "draft"
		} else {
			product.Status = "published"
		}
		products = append(products, *product)
	}
	products = appendPrivateBundleInventoryProducts(products)
	sort.SliceStable(products, func(i, j int) bool {
		return products[i].Handle < products[j].Handle
	})
	if err := resolveReviewedBundleVariants(products); err != nil {
		return nil, err
	}
	return products, nil
}

func parseIdentity(record sourceRecord) parsedIdentity {
	name := normalizeSpaces(record.ProductName)
	identity := parsedIdentity{Confidence: "high"}
	working := name
	if match := formatSuffixRegex.FindStringSubmatch(name); len(match) == 2 {
		identity.FormatSuffix = strings.TrimSpace(match[1])
		working = strings.TrimSpace(strings.TrimSuffix(name, match[0]))
	}
	parts := firstTitleSplitRegex.Split(working, 2)
	if len(parts) == 2 {
		artistPart := normalizeSpaces(parts[0])
		titlePart := normalizeSpaces(parts[1])
		identity.ArtistNames = splitArtists(artistPart)
		identity.ReleaseTitle = titlePart
	} else {
		identity.ReleaseTitle = working
		identity.Confidence = "medium"
		identity.AmbiguityCodes = append(identity.AmbiguityCodes, "missing_artist_title_separator")
	}
	if len(identity.ArtistNames) == 0 && looksLikeMerch(record) {
		identity.Confidence = "medium"
	}
	if len(identity.ArtistNames) == 0 && !looksLikeMerch(record) && !bundleRegex.MatchString(name) {
		identity.AmbiguityCodes = append(identity.AmbiguityCodes, "artist_missing")
		identity.Confidence = "low"
	}
	if identity.ReleaseTitle == "" {
		identity.ReleaseTitle = name
		identity.AmbiguityCodes = append(identity.AmbiguityCodes, "title_fallback_to_product_name")
		identity.Confidence = "low"
	}
	return identity
}

func identityForProductType(identity parsedIdentity, productType string) parsedIdentity {
	if productType == "music_release" {
		return identity
	}
	identity.AmbiguityCodes = withoutStrings(
		identity.AmbiguityCodes,
		"missing_artist_title_separator",
		"artist_missing",
	)
	return identity
}

func splitArtists(value string) []string {
	parts := strings.Split(value, "/")
	artists := make([]string, 0, len(parts))
	for _, part := range parts {
		cleaned := normalizeSpaces(part)
		if cleaned != "" {
			artists = append(artists, cleaned)
		}
	}
	return stableUnique(artists)
}

func classifyProductType(record sourceRecord, identity parsedIdentity) string {
	name := strings.ToLower(record.ProductName)
	categories := strings.ToLower(strings.Join(categoryNames(record.Categories), " | "))
	if mysteryBundleRegex.MatchString(name) {
		return "mystery_bundle"
	}
	if strings.Contains(categories, "bundles/deals") || bundleRegex.MatchString(name) {
		return "fixed_bundle"
	}
	if identity.FormatSuffix != "" && len(identity.ArtistNames) > 0 {
		return "music_release"
	}
	if looksLikeMerch(record) {
		return "merch"
	}
	return "music_release"
}

func looksLikeMerch(record sourceRecord) bool {
	name := strings.ToLower(record.ProductName)
	categories := strings.ToLower(strings.Join(categoryNames(record.Categories), " | "))
	merchWords := []string{"shirt", "hoodie", "button", "pin", "patch", "sticker", "zine", "logo", "issue", "magazine"}
	if strings.Contains(categories, "misc.") {
		return true
	}
	for _, word := range merchWords {
		if strings.Contains(name, word) {
			return true
		}
	}
	return false
}

func isSourceSoldOut(record sourceRecord) bool {
	status := strings.ToLower(strings.TrimSpace(record.Status))
	return status == "sold-out" || status == "sold_out" || status == "soldout"
}

func productGroupingKey(productType string, identity parsedIdentity, record sourceRecord) string {
	if productType == "fixed_bundle" || productType == "mystery_bundle" || productType == "merch" {
		return strings.Join([]string{productType, record.ProductName}, "|")
	}
	artistKey := strings.Join(identity.ArtistNames, "/")
	if artistKey == "" {
		artistKey = "unknown-artist"
	}
	return strings.Join([]string{productType, artistKey, identity.ReleaseTitle}, "|")
}

func displayProductTitle(productType string, identity parsedIdentity, record sourceRecord) string {
	if productType == "fixed_bundle" || productType == "mystery_bundle" || productType == "merch" {
		return normalizeSpaces(strings.Trim(strings.TrimSuffix(record.ProductName, identity.FormatSuffix), " -,"))
	}
	return identity.ReleaseTitle
}

func productStatus(identity parsedIdentity) string {
	if len(identity.AmbiguityCodes) > 0 {
		return "draft"
	}
	return "published"
}

func variantsFromRecord(record sourceRecord, product *normalizedProduct, identity parsedIdentity, productType string) []normalizedVariant {
	options := record.Options
	if len(options) == 0 {
		formatNames := []string{firstNonEmptyString(identity.FormatSuffix, "Standard")}
		if strings.Contains(identity.FormatSuffix, ",") {
			formatNames = nil
			for _, rawFormat := range strings.Split(identity.FormatSuffix, ",") {
				if formatName := normalizeSpaces(rawFormat); formatName != "" {
					formatNames = append(formatNames, formatName)
				}
			}
		}
		options = make([]sourceOption, 0, len(formatNames))
		for index, formatName := range formatNames {
			options = append(options, sourceOption{
				ID:      json.RawMessage(strconv.Quote(fmt.Sprintf("synthetic-%d", index))),
				Name:    formatName,
				Price:   firstNonZeroFloat(record.DefaultPrice, record.Price),
				SoldOut: isSourceSoldOut(record),
			})
		}
	}
	preorder := preorderRegex.MatchString(record.Description)
	backorder := backorderRegex.MatchString(record.Description)
	releaseDate := preorderReleaseDate(record)
	var variants []normalizedVariant
	for index, option := range options {
		formatSource := option.Name
		if identity.FormatSuffix != "" && strings.EqualFold(normalizeSpaces(option.Name), normalizeSpaces(record.ProductName)) {
			formatSource = identity.FormatSuffix
		}
		format, detail, display := normalizeVariantFormat(formatSource, identity.FormatSuffix, productType, len(options))
		price := firstNonZeroFloat(option.Price, record.DefaultPrice, record.Price)
		priceCents := int(price*100 + 0.5)
		priceEstimate, hasReviewedPriceEstimate := reviewedPriceEstimateFor(record.ProductID, format)
		if priceCents <= 0 && hasReviewedPriceEstimate {
			priceCents = priceEstimate.PriceUSDCents
		}
		low := option.IsLowInventory || option.IsAlmostSoldOut
		stock := seededInventory(option.SoldOut, low, preorder, productType)
		sku := buildSKU(product.Handle, display, record.ProductID, index)
		variantMetadata := map[string]any{
			"schema":                  phase6ImportMetadataSchema,
			"source_product_id":       record.ProductID,
			"source_option_id":        rawIDToString(option.ID),
			"source_option_name":      normalizeSpaces(option.Name),
			"source_sold_out":         option.SoldOut,
			"source_low_inventory":    low,
			"seed_inventory_quantity": stock,
		}
		if priceCents > 0 && hasReviewedPriceEstimate && price <= 0 {
			variantMetadata["price_source"] = "reviewed_estimate"
			variantMetadata["price_estimate_basis"] = priceEstimate.Basis
			variantMetadata["price_reviewed_at"] = "2026-07-19"
		}
		if productType == "fixed_bundle" {
			variantMetadata["inventory_mode"] = "component_derived"
		}
		variant := normalizedVariant{
			SourceProductID:     record.ProductID,
			SourceOptionID:      rawIDToString(option.ID),
			SourceOptionName:    normalizeSpaces(option.Name),
			DisplayLabel:        display,
			FormatLabel:         format,
			FormatDetailLabel:   detail,
			SKU:                 sku,
			PriceUSDCents:       priceCents,
			SourceSoldOut:       option.SoldOut,
			SourceLowInventory:  low,
			SeedInventory:       stock,
			ManageInventory:     true,
			AllowBackorder:      backorder,
			PreorderAllowed:     preorder && releaseDate != "",
			PreorderReleaseDate: releaseDate,
			BackorderAllowed:    backorder,
			ImageURL:            firstString(product.Images),
			Metadata:            variantMetadata,
		}
		if backorder {
			variant.BackorderNote = "Eligible for client-managed backorder after import review."
		}
		if preorder && releaseDate == "" {
			variant.AmbiguityCodes = append(variant.AmbiguityCodes, "preorder_date_ambiguous")
			product.AmbiguityCodes = appendUnique(product.AmbiguityCodes, "preorder_date_ambiguous")
		}
		if priceCents <= 0 {
			variant.AmbiguityCodes = append(variant.AmbiguityCodes, "missing_or_zero_price")
			product.AmbiguityCodes = appendUnique(product.AmbiguityCodes, "missing_or_zero_price")
		}
		variants = append(variants, variant)
	}
	return variants
}

func reviewedPriceEstimateFor(sourceProductID string, formatLabel string) (reviewedPriceEstimate, bool) {
	estimate, ok := reviewedPriceEstimates[sourceProductID+"|"+formatLabel]
	return estimate, ok
}

func normalizeVariantFormat(optionName string, suffix string, productType string, optionCount int) (string, string, string) {
	source := normalizeSpaces(firstNonEmptyString(optionName, suffix, "Standard"))
	lower := strings.ToLower(source)
	format := "Standard"
	detail := ""
	if (productType == "fixed_bundle" || productType == "mystery_bundle") && optionCount == 1 {
		return "Bundle", "", "Bundle"
	}
	switch {
	case strings.Contains(lower, "cassette") || strings.Contains(lower, "tape") || strings.Contains(lower, "mc") || strings.Contains(lower, "shell"):
		format = "Cassette"
	case strings.Contains(lower, "vinyl") || strings.Contains(lower, "lp") || strings.Contains(lower, `7"`) || strings.Contains(lower, `12"`):
		format = "Vinyl"
	case strings.Contains(lower, "dvd"):
		format = "DVD"
	case regexp.MustCompile(`(?i)\bcd\b|\d+\s*cd`).MatchString(source):
		format = "CD"
	case productType == "fixed_bundle" || productType == "mystery_bundle":
		format = "Bundle"
	}
	if format != "Standard" {
		if match := multiUnitFormatRegex.FindStringSubmatch(source); len(match) == 4 {
			detail = strings.ToUpper(match[1] + match[2])
			if match[3] != "" {
				detail += " Boxset"
			}
		} else {
			detail = source
			for _, token := range []string{"Vinyl", "vinyl", "LP", "lp", "CD", "cd", "Cassette", "cassette", "MC", "mc", "Tape", "tape", "DVD", "dvd", "Bundle", "bundle"} {
				detail = strings.ReplaceAll(detail, token, "")
			}
			detail = normalizeSpaces(strings.Trim(detail, "-, "))
		}
	}
	display := format
	if optionCount > 1 && detail != "" {
		display = fmt.Sprintf("%s - %s", format, detail)
	}
	if format == "Standard" {
		display = source
	}
	if productType == "fixed_bundle" || productType == "mystery_bundle" {
		display = firstNonEmptyString(source, "Bundle")
		detail = strings.TrimPrefix(display, "Bundle")
	}
	return format, detail, display
}

func seededInventory(soldOut bool, low bool, preorder bool, productType string) int {
	if productType == "fixed_bundle" {
		return 0
	}
	if soldOut {
		return 0
	}
	if productType == "mystery_bundle" {
		return defaultManualBundleStock
	}
	if preorder {
		return defaultPreorderStock
	}
	if low {
		return defaultLowStock
	}
	return defaultAvailableStock
}

func buildBundlePlan(product *normalizedProduct, records []sourceRecord) *bundlePlan {
	plan := &bundlePlan{
		BundleType:      "fixed",
		InventoryMode:   "component_derived",
		FulfillmentMode: "ship_components",
		RequiresReview:  true,
		ReviewReason:    "Bundle components require client review before automated component linking.",
	}
	if product.ProductType == "mystery_bundle" {
		plan.BundleType = "mystery"
		plan.InventoryMode = "manual"
		plan.FulfillmentMode = "manual"
		plan.RequiresReview = false
		plan.ReviewReason = ""
		return plan
	}
	if reviewed, ok := reviewedBundleDefinitions[product.Handle]; ok {
		plan.RequiresReview = false
		plan.ReviewReason = ""
		plan.IncludedPackageItems = append([]string{}, reviewed.IncludedPackageItems...)
		product.Artists = append([]string{}, reviewed.Artists...)
		product.SearchKeywords = stableUnique(append(product.SearchKeywords, reviewed.Artists...))
		for _, component := range reviewed.Components {
			selectionMode := firstNonEmptyString(component.SelectionMode, "exact")
			componentKind := firstNonEmptyString(component.ComponentKind, "product_variant")
			mappingDefinitions := append([]reviewedBundleFormatMapping{}, component.FormatMappings...)
			if len(mappingDefinitions) == 0 {
				mappingDefinitions = []reviewedBundleFormatMapping{
					{
						ComponentFormatLabel:   component.FormatLabel,
						ComponentFormatDetails: append([]string{}, component.FormatDetails...),
						BundleFormatLabel:      component.BundleFormatLabel,
						SelectionMode:          selectionMode,
					},
				}
			}
			if len(mappingDefinitions) > 1 {
				selectionMode = "by_bundle_variant"
			}
			plan.ComponentCandidates = append(plan.ComponentCandidates, bundleComponentCandidate{
				Handle:             component.ProductHandle,
				Title:              component.DisplayTitle,
				Artist:             artistFromBundleDisplayTitle(component.DisplayTitle),
				Quantity:           1,
				FormatLabel:        component.FormatLabel,
				FormatDetails:      append([]string{}, component.FormatDetails...),
				BundleFormatLabel:  component.BundleFormatLabel,
				SelectionMode:      selectionMode,
				ComponentKind:      componentKind,
				mappingDefinitions: mappingDefinitions,
			})
		}
		return plan
	}
	if discographyRegex.MatchString(strings.Join(product.SourceNames, " ")) && len(product.Artists) == 1 {
		artist := product.Artists[0]
		candidates := make([]bundleComponentCandidate, 0)
		for _, record := range records {
			id := parseIdentity(record)
			if len(id.ArtistNames) == 1 && strings.EqualFold(id.ArtistNames[0], artist) && !bundleRegex.MatchString(record.ProductName) {
				handle := slugify(productGroupingKey("music_release", id, record), "product")
				candidates = append(candidates, bundleComponentCandidate{
					Handle:        handle,
					Title:         id.ReleaseTitle,
					Artist:        artist,
					Quantity:      1,
					SelectionMode: "unresolved",
					ComponentKind: "product_variant",
				})
			}
		}
		if len(candidates) > 0 {
			plan.ComponentCandidates = candidates
			plan.ReviewReason = "Discography bundle candidates were inferred by same artist; confirm exact included variants before apply."
		}
	}
	return plan
}

func artistFromBundleDisplayTitle(value string) string {
	parts := strings.SplitN(value, " — ", 2)
	if len(parts) != 2 {
		return ""
	}
	return parts[0]
}

func cdAndVinylBundleMappings() []reviewedBundleFormatMapping {
	return []reviewedBundleFormatMapping{
		{ComponentFormatLabel: "CD", BundleFormatLabel: "CD", SelectionMode: "exact"},
		{ComponentFormatLabel: "Vinyl", BundleFormatLabel: "Vinyl", SelectionMode: "exact"},
	}
}

func appendPrivateBundleInventoryProducts(products []normalizedProduct) []normalizedProduct {
	needsYogyakartaKit := false
	for _, product := range products {
		if product.Handle == "fixed-bundle-special-region-of-yogyakarta-bundle" {
			needsYogyakartaKit = true
		}
		if product.Handle == privateYogyakartaKitHandle {
			return products
		}
	}
	if !needsYogyakartaKit {
		return products
	}

	description := "Private inventory-only component for the numbered drawstring bag and package extras. Enter the verified remaining kit quantity before enabling bundle purchase."
	return append(products, normalizedProduct{
		SourceProductIDs: []string{},
		SourceURLs:       []string{},
		SourceNames:      []string{"Internal inventory: Special Region of Yogyakarta numbered kit"},
		Handle:           privateYogyakartaKitHandle,
		Title:            "Special Region of Yogyakarta numbered bag kit",
		ProductType:      "merch",
		Status:           "draft",
		Label:            defaultLabel,
		Artists:          []string{},
		Genres:           []string{},
		UtilityTags:      []string{"Internal inventory component"},
		SearchKeywords:   []string{},
		DescriptionText:  description,
		DescriptionHTML:  "<p>" + html.EscapeString(description) + "</p>",
		Images:           []string{},
		Variants: []normalizedVariant{
			{
				SourceOptionName: "Numbered bag kit",
				DisplayLabel:     "Numbered bag kit",
				FormatLabel:      "Standard",
				SKU:              privateYogyakartaKitSKU,
				PriceUSDCents:    0,
				SourceSoldOut:    true,
				SeedInventory:    0,
				ManageInventory:  true,
				AllowBackorder:   false,
				PreorderAllowed:  false,
				BackorderAllowed: false,
				Metadata: map[string]any{
					"schema":                  phase6ImportMetadataSchema,
					"internal_inventory_only": true,
					"inventory_count_status":  "unknown",
					"seed_inventory_quantity": 0,
				},
			},
		},
		SourceCategories: []string{},
		Identity: parsedIdentity{
			ReleaseTitle: "Special Region of Yogyakarta numbered bag kit",
			Confidence:   "reviewed",
		},
		Metadata: map[string]any{
			"schema":                  phase6ImportMetadataSchema,
			"source":                  "reviewed_private_inventory_component",
			"internal_inventory_only": true,
			"publicly_visible":        false,
		},
	})
}

func resolveReviewedBundleVariants(products []normalizedProduct) error {
	byHandle := make(map[string]*normalizedProduct, len(products))
	for index := range products {
		byHandle[products[index].Handle] = &products[index]
	}

	for productIndex := range products {
		bundleProduct := &products[productIndex]
		if bundleProduct.Bundle == nil || bundleProduct.Bundle.RequiresReview {
			continue
		}
		for componentIndex := range bundleProduct.Bundle.ComponentCandidates {
			candidate := &bundleProduct.Bundle.ComponentCandidates[componentIndex]
			componentProduct, ok := byHandle[candidate.Handle]
			if !ok {
				return fmt.Errorf("reviewed bundle %s references missing component %s", bundleProduct.Handle, candidate.Handle)
			}
			for _, mappingDefinition := range candidate.mappingDefinitions {
				componentVariantSKUs := matchingVariantSKUs(*componentProduct, mappingDefinition.ComponentFormatLabel, mappingDefinition.ComponentFormatDetails)
				if len(componentVariantSKUs) == 0 {
					return fmt.Errorf("reviewed bundle %s component %s has no %s variant matching %v", bundleProduct.Handle, candidate.Handle, mappingDefinition.ComponentFormatLabel, mappingDefinition.ComponentFormatDetails)
				}
				selectionMode := firstNonEmptyString(mappingDefinition.SelectionMode, "exact")
				if selectionMode == "exact" && len(componentVariantSKUs) != 1 {
					return fmt.Errorf("reviewed bundle %s component %s expected one exact variant, found %d", bundleProduct.Handle, candidate.Handle, len(componentVariantSKUs))
				}
				bundleVariantSKUs := matchingVariantSKUs(*bundleProduct, mappingDefinition.BundleFormatLabel, nil)
				if len(bundleVariantSKUs) == 0 {
					return fmt.Errorf("reviewed bundle %s has no bundle variant for format %s", bundleProduct.Handle, mappingDefinition.BundleFormatLabel)
				}
				candidate.ComponentVariantSKUs = appendUnique(candidate.ComponentVariantSKUs, componentVariantSKUs...)
				candidate.BundleVariantSKUs = appendUnique(candidate.BundleVariantSKUs, bundleVariantSKUs...)
				candidate.VariantMappings = append(candidate.VariantMappings, bundleComponentVariantMapping{
					BundleVariantSKUs:    bundleVariantSKUs,
					ComponentVariantSKUs: componentVariantSKUs,
					SelectionMode:        selectionMode,
				})
			}
		}
	}
	return nil
}

func matchingVariantSKUs(product normalizedProduct, formatLabel string, prioritizedDetails []string) []string {
	if len(prioritizedDetails) > 0 {
		var matches []string
		for _, detail := range prioritizedDetails {
			for _, variant := range product.Variants {
				if strings.EqualFold(variant.FormatLabel, formatLabel) && strings.EqualFold(variant.FormatDetailLabel, detail) {
					matches = append(matches, variant.SKU)
				}
			}
		}
		return matches
	}

	var matches []string
	for _, variant := range product.Variants {
		if formatLabel == "" || strings.EqualFold(variant.FormatLabel, formatLabel) {
			matches = append(matches, variant.SKU)
		}
	}
	return matches
}

func genresFromCategories(categories []sourceCategory) []string {
	excluded := map[string]bool{
		"cds":                 true,
		"vinyl":               true,
		"cassettes":           true,
		"bundles/deals":       true,
		"remorseless records": true,
		"misc.":               true,
	}
	var genres []string
	for _, category := range categories {
		name := normalizeSpaces(category.Name)
		if name == "" || excluded[strings.ToLower(name)] {
			continue
		}
		genres = append(genres, name)
	}
	return stableUnique(genres)
}

func utilityTagsFromRecord(record sourceRecord, productType string) []string {
	var tags []string
	name := strings.ToLower(record.ProductName)
	if preorderRegex.MatchString(record.Description) {
		tags = append(tags, "Preorder source note")
	}
	if productType == "fixed_bundle" || productType == "mystery_bundle" {
		tags = append(tags, "Bundle")
	}
	if strings.Contains(name, "discography") {
		tags = append(tags, "Discography bundle")
	}
	return stableUnique(tags)
}

func searchKeywordsFromRecord(record sourceRecord, identity parsedIdentity) []string {
	var values []string
	values = append(values, identity.ArtistNames...)
	values = append(values, identity.ReleaseTitle)
	values = append(values, record.ProductName)
	values = append(values, genresFromCategories(record.Categories)...)
	return stableUnique(values)
}

func preorderReleaseDate(record sourceRecord) string {
	text := record.Description
	year := yearFromTimestamp(record.CreatedAt)
	if year == 0 {
		year = time.Now().UTC().Year()
	}
	if match := explicitMonthDayRegex.FindStringSubmatch(text); len(match) == 3 {
		month := monthNumber(match[1])
		day, _ := strconv.Atoi(match[2])
		if month > 0 && day > 0 {
			return time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC).Format(time.RFC3339)
		}
	}
	if match := endOfMonthRegex.FindStringSubmatch(text); len(match) == 2 {
		month := monthNumber(match[1])
		if month > 0 {
			date := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC)
			return date.Format(time.RFC3339)
		}
	}
	return ""
}

func releaseYear(value string) int {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0
	}
	return t.Year()
}

func yearFromTimestamp(value string) int {
	if value == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0
	}
	return t.Year()
}

func monthNumber(value string) int {
	months := map[string]int{
		"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
		"july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
	}
	return months[strings.ToLower(value)]
}

func imageURLs(record sourceRecord) []string {
	if len(record.GalleryURLs) > 0 {
		return stableUnique(record.GalleryURLs)
	}
	var urls []string
	for _, image := range record.Images {
		if image.URL != "" {
			urls = append(urls, image.URL)
		}
	}
	return stableUnique(urls)
}

func dedupeVariants(variants []normalizedVariant) []normalizedVariant {
	seen := map[string]bool{}
	result := make([]normalizedVariant, 0, len(variants))
	for _, variant := range variants {
		key := strings.Join([]string{variant.DisplayLabel, strconv.Itoa(variant.PriceUSDCents), variant.SourceOptionID}, "|")
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, variant)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].DisplayLabel < result[j].DisplayLabel
	})
	return result
}

func ensureUniqueHandles(products []normalizedProduct) {
	counts := map[string]int{}
	for i := range products {
		base := slugify(products[i].Handle, fmt.Sprintf("product-%d", i+1))
		counts[base]++
		if counts[base] == 1 {
			products[i].Handle = base
			continue
		}
		products[i].Handle = fmt.Sprintf("%s-%d", base, counts[base])
	}
}

func ensureUniqueSKUs(products []normalizedProduct) {
	seen := map[string]int{}
	for productIndex := range products {
		for variantIndex := range products[productIndex].Variants {
			base := slugify(products[productIndex].Variants[variantIndex].SKU, "variant")
			upper := strings.ToUpper(strings.ReplaceAll(base, "-", "_"))
			seen[upper]++
			if seen[upper] > 1 {
				upper = fmt.Sprintf("%s_%d", upper, seen[upper])
			}
			products[productIndex].Variants[variantIndex].SKU = upper
		}
	}
}

func buildSKU(handle string, display string, sourceProductID string, index int) string {
	seed := strings.Join([]string{handle, display, sourceProductID, strconv.Itoa(index)}, "-")
	return strings.ToUpper(strings.ReplaceAll(slugify(seed, "variant"), "-", "_"))
}

func writeCleanedSourceCSV(path string, products []normalizedProduct) error {
	headers := []string{
		"source_product_ids", "source_urls", "normalized_handle", "product_type", "product_status", "product_title",
		"artists", "label", "genres", "utility_tags", "variant_sku", "variant_display_label", "format", "format_detail",
		"price_usd_cents", "source_sold_out", "seed_inventory_quantity", "preorder_allowed", "preorder_release_date",
		"backorder_allowed", "image_urls", "ambiguity_codes",
	}
	return writeCSV(path, headers, func(w *csv.Writer) error {
		for _, product := range products {
			for _, variant := range product.Variants {
				row := []string{
					strings.Join(product.SourceProductIDs, "|"),
					strings.Join(product.SourceURLs, "|"),
					product.Handle,
					product.ProductType,
					product.Status,
					product.Title,
					strings.Join(product.Artists, "|"),
					product.Label,
					strings.Join(product.Genres, "|"),
					strings.Join(product.UtilityTags, "|"),
					variant.SKU,
					variant.DisplayLabel,
					variant.FormatLabel,
					variant.FormatDetailLabel,
					positiveIntString(variant.PriceUSDCents),
					strconv.FormatBool(variant.SourceSoldOut),
					strconv.Itoa(variant.SeedInventory),
					strconv.FormatBool(variant.PreorderAllowed),
					variant.PreorderReleaseDate,
					strconv.FormatBool(variant.BackorderAllowed),
					strings.Join(product.Images, "|"),
					strings.Join(stableUnique(append(product.AmbiguityCodes, variant.AmbiguityCodes...)), "|"),
				}
				if err := w.Write(row); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func uploaderHeaders(maxImages int) []string {
	headers := []string{
		"Product Id",
		"Product Handle",
		"Product Title",
		"Product Subtitle",
		"Product Status",
		"Product Description",
		"Product External Id",
		"Product Thumbnail",
		"Product Discountable",
		"Product Metadata",
		"Product Sales Channel 1",
		"Variant Id",
		"Variant Title",
		"Variant SKU",
		"Variant Manage Inventory",
		"Variant Allow Backorder",
		"Variant Metadata",
		"Variant Price USD",
		"Variant Option 1 Name",
		"Variant Option 1 Value",
	}
	for i := 1; i <= maxImages; i++ {
		headers = append(headers, fmt.Sprintf("Product Image %d", i))
	}
	return headers
}

func writeUploaderCSV(path string, products []normalizedProduct, salesChannelID string) error {
	maxImages := 1
	for _, product := range products {
		if len(product.Images) > maxImages {
			maxImages = len(product.Images)
		}
	}
	headers := uploaderHeaders(maxImages)
	return writeCSV(path, headers, func(w *csv.Writer) error {
		for _, product := range products {
			for _, variant := range product.Variants {
				externalID := ""
				productSalesChannelID := salesChannelID
				discountable := "true"
				if len(product.SourceProductIDs) > 0 {
					externalID = "bigcartel:" + strings.Join(product.SourceProductIDs, ",")
				}
				if product.Metadata["internal_inventory_only"] == true {
					productSalesChannelID = ""
					discountable = "false"
				}
				productMetadata := map[string]any{
					"catalog_import": map[string]any{
						"schema":             phase6ImportMetadataSchema,
						"source_product_ids": product.SourceProductIDs,
						"source_urls":        product.SourceURLs,
						"product_type":       product.ProductType,
						"artists":            product.Artists,
						"label":              product.Label,
						"genres":             product.Genres,
						"utility_tags":       product.UtilityTags,
						"description_html":   product.DescriptionHTML,
						"release_date":       product.ReleaseDate,
						"release_year":       product.ReleaseYear,
						"ambiguity_codes":    product.AmbiguityCodes,
					},
				}
				variantMetadata := map[string]any{
					"catalog_import": variant.Metadata,
				}
				row := []string{
					"",
					product.Handle,
					product.Title,
					"",
					product.Status,
					product.DescriptionText,
					externalID,
					firstString(product.Images),
					discountable,
					mustJSON(productMetadata),
					productSalesChannelID,
					"",
					variant.DisplayLabel,
					variant.SKU,
					"true",
					strings.ToLower(strconv.FormatBool(variant.AllowBackorder)),
					mustJSON(variantMetadata),
					positiveIntString(variant.PriceUSDCents),
					"Format",
					variant.DisplayLabel,
				}
				for _, imageURL := range product.Images {
					row = append(row, imageURL)
				}
				for len(row) < len(headers) {
					row = append(row, "")
				}
				if err := w.Write(row); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func writeInventoryCSV(path string, products []normalizedProduct) error {
	headers := []string{
		"product_handle", "variant_sku", "stock_location_id", "stocked_quantity", "incoming_quantity",
		"required_quantity", "source_sold_out", "source_low_inventory", "notes",
	}
	return writeCSV(path, headers, func(w *csv.Writer) error {
		for _, product := range products {
			for _, variant := range product.Variants {
				note := "Stock quantity is a deterministic staging seed because BigCartel scrape exposes sold_out/low flags, not exact inventory amount."
				if product.ProductType == "fixed_bundle" {
					note = "Fixed bundles have no independent stock seed; availability must be derived from the reviewed component variant mappings."
				}
				if variant.Metadata["internal_inventory_only"] == true {
					note = "Private bundle-kit inventory starts at zero because the remaining physical kit count is unknown; enter a verified count before enabling bundle purchase."
				}
				row := []string{
					product.Handle,
					variant.SKU,
					"${MEDUSA_STOCK_LOCATION_ID}",
					strconv.Itoa(variant.SeedInventory),
					"0",
					"1",
					strconv.FormatBool(variant.SourceSoldOut),
					strconv.FormatBool(variant.SourceLowInventory),
					note,
				}
				if err := w.Write(row); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func writeAmbiguitiesCSV(path string, products []normalizedProduct) error {
	headers := []string{"product_handle", "product_title", "product_type", "source_names", "variant_sku", "codes"}
	return writeCSV(path, headers, func(w *csv.Writer) error {
		for _, product := range products {
			if len(product.AmbiguityCodes) == 0 {
				for _, variant := range product.Variants {
					if len(variant.AmbiguityCodes) > 0 {
						row := []string{product.Handle, product.Title, product.ProductType, strings.Join(product.SourceNames, "|"), variant.SKU, strings.Join(variant.AmbiguityCodes, "|")}
						if err := w.Write(row); err != nil {
							return err
						}
					}
				}
				continue
			}
			row := []string{product.Handle, product.Title, product.ProductType, strings.Join(product.SourceNames, "|"), "", strings.Join(product.AmbiguityCodes, "|")}
			if err := w.Write(row); err != nil {
				return err
			}
		}
		return nil
	})
}

func buildCatalogArtifact(products []normalizedProduct) catalogArtifact {
	refs := map[string]catalogReferenceValue{}
	artists := map[string]catalogArtist{}
	artifact := catalogArtifact{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Notes: []string{
			"Product and variant IDs are intentionally not present before CSV import; apply code must resolve by product handle and variant SKU after the Medusa import completes.",
			"Inventory quantities are staged separately because Medusa 2.17.1 product CSV import does not accept stock quantity columns.",
			"Reviewed bundle components include exact component and bundle variant SKUs. Selection mode any consumes exactly one eligible component variant in listed priority order.",
		},
	}
	addRef := func(kind string, label string) {
		if label == "" {
			return
		}
		value := slugify(label, kind)
		refs[kind+"|"+value] = catalogReferenceValue{Kind: kind, Label: label, Value: value}
	}
	for _, label := range []string{defaultLabel, "Music release", "Merch", "Fixed bundle", "Mystery bundle"} {
		kind := "label"
		if label != defaultLabel {
			kind = "product_type"
		}
		addRef(kind, label)
	}
	for _, product := range products {
		addRef("label", product.Label)
		addRef("product_type", productTypeLabel(product.ProductType))
		for _, genre := range product.Genres {
			addRef("genre", genre)
		}
		for _, tag := range product.UtilityTags {
			addRef("utility_tag", tag)
		}
		for _, artist := range product.Artists {
			artists[slugify(artist, "artist")] = catalogArtist{Name: artist, Slug: slugify(artist, "artist")}
		}
		for _, variant := range product.Variants {
			addRef("format", variant.FormatLabel)
			addRef("format_detail", variant.FormatDetailLabel)
			artifact.VariantProfiles = append(artifact.VariantProfiles, catalogVariantProfile{
				ProductHandle:       product.Handle,
				VariantSKU:          variant.SKU,
				Format:              variant.FormatLabel,
				FormatDetail:        variant.FormatDetailLabel,
				DisplayLabel:        variant.DisplayLabel,
				PreorderAllowed:     variant.PreorderAllowed,
				PreorderReleaseDate: variant.PreorderReleaseDate,
				BackorderAllowed:    variant.BackorderAllowed,
				BackorderNote:       variant.BackorderNote,
				ImageURL:            variant.ImageURL,
				Metadata:            variant.Metadata,
			})
		}
		refsForProduct := []profileRef{}
		for index, genre := range product.Genres {
			refsForProduct = append(refsForProduct, profileRef{Kind: "genre", Label: genre, SortOrder: index})
		}
		offset := len(refsForProduct)
		for index, tag := range product.UtilityTags {
			refsForProduct = append(refsForProduct, profileRef{Kind: "utility_tag", Label: tag, SortOrder: offset + index})
		}
		artifact.ProductProfiles = append(artifact.ProductProfiles, catalogProductProfile{
			ProductHandle:   product.Handle,
			ReleaseTitle:    product.Title,
			Label:           product.Label,
			ProductType:     productTypeLabel(product.ProductType),
			ReleaseDate:     product.ReleaseDate,
			ReleaseYear:     product.ReleaseYear,
			DescriptionHTML: product.DescriptionHTML,
			SearchKeywords:  product.SearchKeywords,
			Artists:         product.Artists,
			References:      refsForProduct,
			Tracklist:       []any{},
			Credits:         map[string]any{},
			PressingNotes:   map[string]any{},
			MerchDetails:    merchDetails(product),
			Metadata:        product.Metadata,
		})
		for index, imageURL := range product.Images {
			artifact.Media = append(artifact.Media, catalogMediaItem{
				ProductHandle:    product.Handle,
				SourceURL:        imageURL,
				Role:             ternary(index == 0, "primary", "gallery"),
				SortOrder:        index,
				IsPrimary:        index == 0,
				AltText:          altText(product),
				DerivativeStatus: "source_only",
				Metadata: map[string]any{
					"schema": phase6ImportMetadataSchema,
				},
			})
		}
		if product.Bundle != nil {
			artifact.Bundles = append(artifact.Bundles, catalogBundleProfile{
				ProductHandle:   product.Handle,
				BundleType:      product.Bundle.BundleType,
				InventoryMode:   product.Bundle.InventoryMode,
				FulfillmentMode: product.Bundle.FulfillmentMode,
				DisplayTitle:    product.Title,
				DescriptionHTML: product.DescriptionHTML,
				IsActive:        true,
				RequiresReview:  product.Bundle.RequiresReview,
				ReviewReason:    product.Bundle.ReviewReason,
				Metadata: map[string]any{
					"schema":                 phase6ImportMetadataSchema,
					"component_candidates":   product.Bundle.ComponentCandidates,
					"included_package_items": product.Bundle.IncludedPackageItems,
				},
			})
			for index, candidate := range product.Bundle.ComponentCandidates {
				artifact.BundleComponents = append(artifact.BundleComponents, catalogBundleComponent{
					BundleHandle:           product.Handle,
					ComponentProductHandle: candidate.Handle,
					ComponentVariantSKUs:   candidate.ComponentVariantSKUs,
					BundleVariantSKUs:      candidate.BundleVariantSKUs,
					Title:                  candidate.Title,
					Quantity:               candidate.Quantity,
					SortOrder:              index,
					IsRequired:             true,
					SelectionMode:          candidate.SelectionMode,
					ComponentKind:          candidate.ComponentKind,
					VariantMappings:        candidate.VariantMappings,
					NeedsResolution:        product.Bundle.RequiresReview,
					Metadata: map[string]any{
						"schema":              phase6ImportMetadataSchema,
						"format_label":        candidate.FormatLabel,
						"format_details":      candidate.FormatDetails,
						"bundle_format_label": candidate.BundleFormatLabel,
					},
				})
			}
		}
	}
	for _, ref := range refs {
		artifact.ReferenceValues = append(artifact.ReferenceValues, ref)
	}
	sort.Slice(artifact.ReferenceValues, func(i, j int) bool {
		if artifact.ReferenceValues[i].Kind == artifact.ReferenceValues[j].Kind {
			return artifact.ReferenceValues[i].Label < artifact.ReferenceValues[j].Label
		}
		return artifact.ReferenceValues[i].Kind < artifact.ReferenceValues[j].Kind
	})
	for _, artist := range artists {
		artifact.Artists = append(artifact.Artists, artist)
	}
	sort.Slice(artifact.Artists, func(i, j int) bool {
		return artifact.Artists[i].Name < artifact.Artists[j].Name
	})
	return artifact
}

func buildPreview(
	sourcePath string,
	currentURLsPath string,
	currentURLs map[string]bool,
	excludedUnlistedSourceCount int,
	products []normalizedProduct,
	salesChannelID string,
) importPreview {
	artistSet := map[string]bool{}
	genreSet := map[string]bool{}
	tagSet := map[string]bool{}
	imageSet := map[string]bool{}
	ambiguityCounts := map[string]int{}
	preview := importPreview{
		GeneratedAt:                 time.Now().UTC().Format(time.RFC3339),
		SourcePath:                  sourcePath,
		CurrentURLsPath:             currentURLsPath,
		SalesChannelID:              salesChannelID,
		CurrentListingCount:         len(currentURLs),
		ExcludedUnlistedSourceCount: excludedUnlistedSourceCount,
		AmbiguityCounts:             ambiguityCounts,
		HeaderContract:              uploaderHeaders(maxImageCount(products)),
		OutputFiles:                 map[string]string{},
		SHA256:                      map[string]string{},
	}
	if salesChannelID == "" {
		preview.Warnings = append(preview.Warnings, "MEDUSA_DEFAULT_SALES_CHANNEL_ID was not set; Product Sales Channel 1 cells are blank in the uploader CSV.")
	}
	for _, product := range products {
		preview.NormalizedProductCount++
		preview.SourceProductCount += len(product.SourceProductIDs)
		if product.Metadata["internal_inventory_only"] == true {
			preview.InternalInventoryProductCount++
		}
		switch product.ProductType {
		case "music_release":
			preview.MusicReleaseCount++
		case "merch":
			preview.MerchCount++
		case "fixed_bundle":
			preview.BundleCount++
			preview.FixedBundleCount++
			if product.Bundle != nil && !product.Bundle.RequiresReview {
				preview.ReviewedFixedBundleCount++
				preview.BundleComponentCount += len(product.Bundle.ComponentCandidates)
			}
		case "mystery_bundle":
			preview.BundleCount++
			preview.MysteryBundleCount++
		}
		for _, artist := range product.Artists {
			artistSet[artist] = true
		}
		for _, genre := range product.Genres {
			genreSet[genre] = true
		}
		for _, tag := range product.UtilityTags {
			tagSet[tag] = true
		}
		for _, imageURL := range product.Images {
			imageSet[imageURL] = true
		}
		for _, code := range product.AmbiguityCodes {
			ambiguityCounts[code]++
		}
		if len(product.AmbiguityCodes) > 0 {
			preview.AmbiguityCount++
		}
		if product.ReleaseDate != "" {
			preview.PreorderProductCount++
		}
		for _, variant := range product.Variants {
			preview.UploaderRowCount++
			preview.VariantCount++
			preview.SeedInventoryTotal += variant.SeedInventory
			if variant.SourceSoldOut {
				preview.SoldOutVariantCount++
			}
			if variant.SourceLowInventory {
				preview.LowInventoryVariantCount++
			}
			if variant.BackorderAllowed {
				preview.BackorderEligibleVariantCount++
			}
			if variant.Metadata["price_source"] == "reviewed_estimate" {
				preview.ReviewedPriceEstimateCount++
			}
			for _, code := range variant.AmbiguityCodes {
				ambiguityCounts[code]++
			}
		}
	}
	preview.ArtistCount = len(artistSet)
	preview.GenreCount = len(genreSet)
	preview.UtilityTagCount = len(tagSet)
	preview.MediaURLCount = len(imageSet)
	return preview
}

func writeContractMarkdown(path string, preview importPreview) error {
	var b strings.Builder
	b.WriteString("# Phase 6 Import Contract\n\n")
	b.WriteString("Generated by `go run ./scripts/generate_remorseless_import.go`.\n\n")
	b.WriteString("## Medusa CSV Uploader Contract\n\n")
	b.WriteString("- Delimiter: comma, emitted with Go `encoding/csv`.\n")
	b.WriteString("- Multiline descriptions and JSON metadata are quoted by the CSV writer.\n")
	b.WriteString("- One CSV row represents one Medusa product variant. Rows are grouped by `Product Handle`.\n")
	b.WriteString("- Handles and SKUs are stable idempotency keys for this migration pass.\n")
	b.WriteString("- Only products present in the current live URL list are emitted. Unlisted source rows are excluded from every import artifact.\n")
	b.WriteString("- The CSV intentionally uses only Medusa 2.17.1 chunked-import headers accepted by `CSVNormalizer`.\n")
	b.WriteString("- Inventory quantities are not in the product CSV because Medusa 2.17.1 rejects unknown stock quantity headers. Use `phase6-inventory-levels.csv` after resolving imported variant IDs and the staging stock location.\n")
	b.WriteString("- Catalog profile, artists, genres, media metadata, variant profile, and bundle semantics are in `phase6-catalog-upserts.json`; apply code must resolve products by handle and variants by SKU after CSV import.\n\n")
	b.WriteString("## Headers\n\n")
	for _, header := range preview.HeaderContract {
		b.WriteString("- `")
		b.WriteString(header)
		b.WriteString("`\n")
	}
	b.WriteString("\n## Counts\n\n")
	b.WriteString(fmt.Sprintf("- Current live listings: %d\n", preview.CurrentListingCount))
	b.WriteString(fmt.Sprintf("- Unlisted source rows excluded: %d\n", preview.ExcludedUnlistedSourceCount))
	b.WriteString(fmt.Sprintf("- Products: %d\n", preview.NormalizedProductCount))
	b.WriteString(fmt.Sprintf("- Variants/uploader rows: %d\n", preview.VariantCount))
	b.WriteString(fmt.Sprintf("- Bundles: %d fixed, %d mystery\n", preview.FixedBundleCount, preview.MysteryBundleCount))
	b.WriteString(fmt.Sprintf("- Reviewed fixed bundles: %d with %d component requirements\n", preview.ReviewedFixedBundleCount, preview.BundleComponentCount))
	b.WriteString(fmt.Sprintf("- Private inventory-only products: %d\n", preview.InternalInventoryProductCount))
	b.WriteString(fmt.Sprintf("- Artists: %d\n", preview.ArtistCount))
	b.WriteString(fmt.Sprintf("- Genres: %d\n", preview.GenreCount))
	b.WriteString(fmt.Sprintf("- Unique image URLs: %d\n", preview.MediaURLCount))
	b.WriteString(fmt.Sprintf("- Ambiguous products: %d\n", preview.AmbiguityCount))
	b.WriteString(fmt.Sprintf("- Variants using reviewed price estimates: %d\n", preview.ReviewedPriceEstimateCount))
	if preview.SalesChannelID != "" {
		b.WriteString(fmt.Sprintf("- Staging sales channel: `%s`\n", preview.SalesChannelID))
	}
	b.WriteString("\n## Stock Seed Policy\n\n")
	b.WriteString("- Source scrape exposes `sold_out`, `isLowInventory`, and `isAlmostSoldOut`, not exact BigCartel stock counts.\n")
	b.WriteString("- Fixed bundle variants seed no independent stock; their availability comes only from the reviewed component mappings.\n")
	b.WriteString("- Sold-out variants seed `0`.\n")
	b.WriteString("- Low/almost-sold-out variants seed `2`.\n")
	b.WriteString("- Normal variants seed `20`.\n")
	b.WriteString("- Preorder variants seed `50` when a release date can be parsed.\n")
	b.WriteString("- Mystery bundles seed `10` because they are client-managed manual bundles.\n\n")
	b.WriteString("## Reviewed Price Estimates\n\n")
	b.WriteString("- Explicit reviewed estimates are used only when the source listing has no positive price. A future positive source price automatically takes precedence.\n")
	b.WriteString("- Estimated variants retain `price_source`, `price_estimate_basis`, and `price_reviewed_at` provenance in variant metadata.\n")
	b.WriteString("- A reviewed estimate resolves the price ambiguity only; a source-sold-out variant still seeds zero inventory and remains unavailable for purchase.\n\n")
	b.WriteString("## Reviewed Bundle Mappings\n\n")
	b.WriteString("- Reviewed fixed bundles contain deterministic component product handles, eligible component variant SKUs, applicable bundle variant SKUs, quantities, and exact/any selection semantics.\n")
	b.WriteString("- Sold-out components remain mapped. They make the applicable bundle variant unavailable instead of disappearing from its contents.\n")
	b.WriteString("- The Special Region of Yogyakarta numbered package uses a hidden inventory-only product seeded at zero until the physical remaining-kit count is verified.\n")
	b.WriteString("- Package extras such as the numbered bag, stickers, pin, and download codes remain bundle display metadata; the private kit inventory component supplies the stock limit.\n\n")
	b.WriteString("## External References\n\n")
	b.WriteString("- Medusa product import user guide: https://docs.medusajs.com/user-guide/products/import\n")
	b.WriteString("- Medusa product module guide: https://docs.medusajs.com/resources/commerce-modules/product\n")
	return writeText(path, b.String())
}

func writeCSV(path string, headers []string, writeRows func(*csv.Writer) error) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()
	writer := csv.NewWriter(file)
	if err := writer.Write(headers); err != nil {
		return err
	}
	if err := writeRows(writer); err != nil {
		return err
	}
	writer.Flush()
	return writer.Error()
}

func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return writeBytes(path, data)
}

func writeText(path string, value string) error {
	return writeBytes(path, []byte(value))
}

func writeBytes(path string, value []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, value, 0o644)
}

func sha256File(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func parseCategories(raw string) []sourceCategory {
	var categories []sourceCategory
	_ = json.Unmarshal([]byte(raw), &categories)
	return categories
}

func parseOptions(raw string) []sourceOption {
	var options []sourceOption
	_ = json.Unmarshal([]byte(raw), &options)
	return options
}

func parseImages(raw string) []sourceImage {
	var images []sourceImage
	_ = json.Unmarshal([]byte(raw), &images)
	return images
}

func parseStringList(raw string) []string {
	var values []string
	_ = json.Unmarshal([]byte(raw), &values)
	return stableUnique(values)
}

func firstNonEmptyCategories(primary []sourceCategory, fallback []sourceCategory) []sourceCategory {
	if len(primary) > 0 {
		return primary
	}
	return fallback
}

func firstNonEmptyOptions(primary []sourceOption, fallback []sourceOption) []sourceOption {
	if len(primary) > 0 {
		return primary
	}
	return fallback
}

func firstNonEmptyImages(primary []sourceImage, fallback []sourceImage) []sourceImage {
	if len(primary) > 0 {
		return primary
	}
	return fallback
}

func rawIDToString(value any) string {
	switch v := value.(type) {
	case json.RawMessage:
		if len(v) == 0 {
			return ""
		}
		var asString string
		if json.Unmarshal(v, &asString) == nil {
			return asString
		}
		var asNumber float64
		if json.Unmarshal(v, &asNumber) == nil {
			return strconv.FormatInt(int64(asNumber), 10)
		}
		return strings.Trim(string(v), `"`)
	case string:
		return v
	case float64:
		return strconv.FormatInt(int64(v), 10)
	case int:
		return strconv.Itoa(v)
	default:
		return ""
	}
}

func firstNonEmptyRaw(primary json.RawMessage, fallback any) any {
	if len(primary) > 0 && string(primary) != "null" {
		return primary
	}
	return fallback
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case fmt.Stringer:
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	default:
		return fmt.Sprintf("%v", v)
	}
}

func floatFromAny(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case string:
		parsed, _ := strconv.ParseFloat(v, 64)
		return parsed
	default:
		return 0
	}
}

func firstNonZeroFloat(values ...float64) float64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func urlFromPath(value string) string {
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	if strings.HasPrefix(value, "/") {
		return "https://www.remorselessrecords.com" + value
	}
	return value
}

func normalizeDescriptionText(value string) string {
	return normalizeSpaces(html.UnescapeString(strings.ReplaceAll(value, `\r\n`, "\n")))
}

func normalizeDescriptionHTML(htmlValue string, fallbackText string) string {
	if strings.TrimSpace(htmlValue) != "" {
		return strings.TrimSpace(htmlValue)
	}
	return textToHTML(fallbackText)
}

func textToHTML(value string) string {
	paragraphs := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n\n")
	var b strings.Builder
	for _, paragraph := range paragraphs {
		cleaned := normalizeSpaces(paragraph)
		if cleaned == "" {
			continue
		}
		b.WriteString("<p>")
		b.WriteString(html.EscapeString(cleaned))
		b.WriteString("</p>")
	}
	return b.String()
}

func categoryNames(categories []sourceCategory) []string {
	var names []string
	for _, category := range categories {
		if cleaned := normalizeSpaces(category.Name); cleaned != "" {
			names = append(names, cleaned)
		}
	}
	return stableUnique(names)
}

func stableUnique(values []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, value := range values {
		cleaned := normalizeSpaces(value)
		if cleaned == "" {
			continue
		}
		key := strings.ToLower(cleaned)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, cleaned)
	}
	return result
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func withoutStrings(values []string, excluded ...string) []string {
	excludedSet := map[string]bool{}
	for _, value := range excluded {
		excludedSet[value] = true
	}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if !excludedSet[value] {
			result = append(result, value)
		}
	}
	return result
}

func appendUnique(base []string, values ...string) []string {
	return stableUnique(append(base, values...))
}

func normalizeSpaces(value string) string {
	return whitespaceRegex.ReplaceAllString(strings.TrimSpace(value), " ")
}

func stripHTML(value string) string {
	return normalizeSpaces(htmlTagRegex.ReplaceAllString(value, " "))
}

func slugify(value string, fallback string) string {
	value = latinSlugReplacer.Replace(strings.ToLower(strings.TrimSpace(value)))
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		if r > unicode.MaxASCII {
			continue
		}
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteRune('-')
			lastDash = true
		}
	}
	result := strings.Trim(b.String(), "-")
	if result == "" {
		return fallback
	}
	return result
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func positiveIntString(value int) string {
	if value <= 0 {
		return ""
	}
	return strconv.Itoa(value)
}

func productTypeLabel(value string) string {
	switch value {
	case "music_release":
		return "Music release"
	case "merch":
		return "Merch"
	case "fixed_bundle":
		return "Fixed bundle"
	case "mystery_bundle":
		return "Mystery bundle"
	default:
		return value
	}
}

func merchDetails(product normalizedProduct) map[string]any {
	if product.ProductType != "merch" {
		return map[string]any{}
	}
	return map[string]any{
		"source_categories": product.SourceCategories,
	}
}

func altText(product normalizedProduct) string {
	if len(product.Artists) > 0 {
		return fmt.Sprintf("%s - %s", strings.Join(product.Artists, " / "), product.Title)
	}
	return product.Title
}

func ternary(condition bool, ifTrue string, ifFalse string) string {
	if condition {
		return ifTrue
	}
	return ifFalse
}

func maxImageCount(products []normalizedProduct) int {
	maxImages := 1
	for _, product := range products {
		if len(product.Images) > maxImages {
			maxImages = len(product.Images)
		}
	}
	return maxImages
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
