import { describe, it, expect, beforeAll } from "vitest";
import { Circomkit, WitnessTester } from "circomkit";

describe("Vendor Utilities", () => {
  let circomkit: Circomkit;
  let circuit: WitnessTester<
    [
      "vals",
      "selectIndex",
      "numberToConvert",
      "mainArray",
      "mainLen",
      "subArray"
    ],
    ["selectedValue", "convertedBytes", "substringFound"]
  >;

  beforeAll(async () => {
    circomkit = new Circomkit({
      verbose: false,
    });
    circuit = await circomkit.WitnessTester("array_selector_test", {
      file: "test/ArraySelectorTest",
      template: "ArraySelectorTest",
      params: [],
    });
  });

  // All tests need valid inputs for all signals since they're all computed together
  // SubstringCheck requires: subLen (4) <= mainLen

  describe("Selector", () => {
    it("selects element at index 0", async () => {
      await circuit.expectPass(
        {
          vals: [100, 200, 300, 400, 500, 600, 700, 800],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { selectedValue: 100 }
      );
    });

    it("selects element at index 3", async () => {
      await circuit.expectPass(
        {
          vals: [10, 20, 30, 40, 50, 60, 70, 80],
          selectIndex: 3,
          numberToConvert: 0,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { selectedValue: 40 }
      );
    });

    it("selects element at last index", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 999],
          selectIndex: 7,
          numberToConvert: 0,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { selectedValue: 999 }
      );
    });
  });

  describe("Num2BigEndianBytes", () => {
    it("converts 0 to [0, 0, 0, 0]", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { convertedBytes: [0, 0, 0, 0] }
      );
    });

    it("converts 255 to [0, 0, 0, 255]", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 255,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { convertedBytes: [0, 0, 0, 255] }
      );
    });

    it("converts 256 to [0, 0, 1, 0]", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 256,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { convertedBytes: [0, 0, 1, 0] }
      );
    });

    it("converts 16909060 (0x01020304) to [1, 2, 3, 4]", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 16909060,
          mainArray: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 4,
          subArray: [0, 0, 0, 0],
        },
        { convertedBytes: [1, 2, 3, 4] }
      );
    });
  });

  describe("SubstringCheck", () => {
    it("finds substring at the beginning", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 8,
          subArray: [5, 6, 7, 8],
        },
        { substringFound: 1 }
      );
    });

    it("finds substring in the middle", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          mainLen: 16,
          subArray: [5, 6, 7, 8],
        },
        { substringFound: 1 }
      );
    });

    it("finds substring at the end", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0],
          mainLen: 8,
          subArray: [5, 6, 7, 8],
        },
        { substringFound: 1 }
      );
    });

    it("does not find non-existent substring", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          mainArray: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
          mainLen: 16,
          subArray: [99, 100, 101, 102],
        },
        { substringFound: 0 }
      );
    });

    it("does not find substring beyond mainLen", async () => {
      await circuit.expectPass(
        {
          vals: [1, 2, 3, 4, 5, 6, 7, 8],
          selectIndex: 0,
          numberToConvert: 0,
          // subArray [9, 10, 11, 12] exists at index 8, but mainLen is 8
          mainArray: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0],
          mainLen: 8,
          subArray: [9, 10, 11, 12],
        },
        { substringFound: 0 }
      );
    });
  });
});
