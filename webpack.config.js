const path = require("path");
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
const version = require("./package.json").version;

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: `y-vault-roi-v${version}.js`,
    path: path.resolve(__dirname, "public")
  },
  mode: "development",
  resolve: {
    extensions: [".js"]
  },
  devServer: {
    contentBase: path.join(__dirname, "public"),
    compress: true,
    port: 8080
  },
  module: {
    rules: [
      { test: /\.js$/, loader: "babel-loader", exclude: /node_modules/ },
      {
        test: /\.css$/,
        use: [
          "style-loader",
          { loader: "css-loader", options: { modules: true } }
        ]
      },
      { test: /\.svg$/, use: { loader: "url-loader" } }
    ]
  }
};
