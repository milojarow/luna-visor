const React = require("react");
const COLORS = {
  ivory: "#F7F5F0",
  bone: "#E8E4DC",
  sand: "#D6D0C4",
  deepBlue: "#1B3A5C",
  nightBlue: "#0F2237",
  amber: "#D4883A",
  amberLight: "#E8A849",
  blueBlack: "#1A1A2E",
  grayBlue: "#5A6478"
};
module.exports = function template({ headline, product, bullets, color, bgDataUri, logoDataUri, width, height, fontSize }) {
  return /* @__PURE__ */ React.createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative"
      }
    },
    bgDataUri ? /* @__PURE__ */ React.createElement(
      "img",
      {
        src: bgDataUri,
        width,
        height,
        style: { position: "absolute", width: "100%", height: "100%", objectFit: "cover" }
      }
    ) : /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", width: "100%", height: "100%", backgroundColor: color } }),
    bgDataUri && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", width: "100%", height: "100%", backgroundColor: "rgba(15, 34, 55, 0.75)" } }),
    /* @__PURE__ */ React.createElement(
      "div",
      {
        style: {
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px",
          fontFamily: "Satoshi"
        }
      },
      /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              fontFamily: "Satoshi",
              fontSize: 28,
              color: COLORS.amberLight,
              letterSpacing: "3px",
              textTransform: "uppercase",
              textShadow: "0 0 12px #D4883A, 0 0 24px #D4883A, 0 0 36px #D4883A"
            }
          },
          product
        ),
        /* @__PURE__ */ React.createElement(
          "img",
          {
            src: logoDataUri,
            width: 80,
            height: 66,
            style: { opacity: 0.9 }
          }
        )
      ),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            height: "2px",
            backgroundColor: COLORS.amber,
            marginTop: "20px",
            width: "100%",
            display: "flex"
          }
        }
      ),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 0"
          }
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              fontFamily: "Clash Display",
              fontSize,
              color: COLORS.ivory,
              textAlign: "center",
              lineHeight: 1.15
            }
          },
          headline
        )
      ),
      bullets.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            height: "2px",
            backgroundColor: COLORS.amber,
            marginBottom: "24px",
            width: "100%",
            display: "flex"
          }
        }
      ), bullets.map((bullet, i) => /* @__PURE__ */ React.createElement(
        "div",
        {
          key: i,
          style: {
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px"
          }
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              fontSize: 24,
              color: COLORS.amberLight,
              textShadow: "0 0 10px #D4883A, 0 0 20px #D4883A, 0 0 30px #D4883A"
            }
          },
          "\u2714"
        ),
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              fontSize: 24,
              color: COLORS.ivory,
              textShadow: "0 0 8px #E8A849, 0 0 16px #D4883A"
            }
          },
          bullet
        )
      ))),
      /* @__PURE__ */ React.createElement(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "center",
            marginTop: bullets.length > 0 ? "16px" : "0"
          }
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              fontSize: 18,
              color: COLORS.ivory,
              opacity: 0.95,
              textShadow: "0 0 10px #E8A849, 0 0 20px #E8A849, 0 0 30px #D4883A"
            }
          },
          "blindandosue\xF1os.com"
        )
      )
    )
  );
};
