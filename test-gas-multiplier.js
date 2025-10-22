const { ethers } = require("ethers");

// Test gas price multiplication by 1.2
function testGasPriceMultiplier() {
    console.log("Testing gas price multiplication by 1.2...");

    // Set up test environment
    process.env.LEGACY_TRANSACTION_GAS_PRICE_MULTIPLIER = "1.2";

    // Test input gas price (in wei)
    const originalGasPrice = ethers.utils.parseUnits("20", "gwei"); // 20 gwei
    console.log("Original gas price:", ethers.utils.formatUnits(originalGasPrice, "gwei"), "gwei");

    // Apply the multiplication logic from the code
    const gasMultiplier = ethers.utils.parseUnits(process.env.LEGACY_TRANSACTION_GAS_PRICE_MULTIPLIER || "1", 1);
    const multipliedGasPrice = originalGasPrice.mul(gasMultiplier).div(ethers.BigNumber.from("10"));

    console.log("Gas multiplier (BigNumber):", gasMultiplier.toString());
    console.log("Gas multiplier (decimal):", ethers.utils.formatUnits(gasMultiplier, 1));

    console.log("Multiplied gas price:", ethers.utils.formatUnits(multipliedGasPrice, "gwei"), "gwei");

    // Expected result: 20 * 1.2 = 24 gwei
    const expectedGasPrice = ethers.utils.parseUnits("24", "gwei");
    console.log("Expected gas price:", ethers.utils.formatUnits(expectedGasPrice, "gwei"), "gwei");

    // Verify the result
    const isCorrect = multipliedGasPrice.eq(expectedGasPrice);
    console.log("Test result:", isCorrect ? "✅ PASS" : "❌ FAIL");

    if (!isCorrect) {
        console.log("Expected:", expectedGasPrice.toString());
        console.log("Actual:", multipliedGasPrice.toString());
    }

    // Test with different gas prices
    console.log("\nTesting with different gas prices:");
    const testCases = [
        { input: "10", expected: "12" },
        { input: "25", expected: "30" },
        { input: "50", expected: "60" },
        { input: "100", expected: "120" }
    ];

    testCases.forEach(({ input, expected }) => {
        const inputGasPrice = ethers.utils.parseUnits(input, "gwei");
        const resultGasPrice = inputGasPrice.mul(gasMultiplier).div(ethers.BigNumber.from("10"));
        const expectedGasPrice = ethers.utils.parseUnits(expected, "gwei");
        const isCorrect = resultGasPrice.eq(expectedGasPrice);

        console.log(`${input} gwei * 1.2 = ${ethers.utils.formatUnits(resultGasPrice, "gwei")} gwei (expected: ${expected} gwei) ${isCorrect ? "✅" : "❌"}`);
    });
}

// Run the test
testGasPriceMultiplier();
