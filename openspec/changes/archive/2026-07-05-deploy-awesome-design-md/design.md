# Design: awesome-design-md Deployment

## Technical Decision
- Clone to `D:\awesome-design-md` (compliant with storage policy)
- No npm/pip/build dependencies — pure markdown collection
- 74 design systems each with DESIGN.md + preview.html + preview-dark.html

## Directory Layout
```
D:\awesome-design-md\
├── design-md/
│   ├── apple/
│   │   ├── DESIGN.md
│   │   ├── preview.html
│   │   └── preview-dark.html
│   ├── vercel/
│   ├── stripe/
│   ├── claude/
│   └── ... (74 total)
├── .github/
├── README.md
└── LICENSE
```

## Usage
Copy any `DESIGN.md` into project root and tell AI agent to use it.
