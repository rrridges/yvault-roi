## Prerequisites

```
brew install yarn
brew install webpack
```

## Getting Started

Install project dependencies

```
yarn install
```

Start the local dev server

```
yarn start
```

Navigate to [http://localhost:8080](http://localhost:8080)

## Deploying

Continuous deployments are setup. Just push to master.

To clear any cache between deploys bump the version numbers:

1. Update the version number in `package.json`

```
"version": "0.0.2",
```

2. Update the version number of the js bundle in `public/index.html`:

```
<script src="flipside-v0.0.2.js"></script>
```
