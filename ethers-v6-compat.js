// Ethers v6 compatibility module
// This replaces the ethers module to provide v6 compatibility

const ethers = require("ethers");

// Add v6 functions that are missing in v5
ethers.id = ethers.utils.id;
ethers.parseUnits = ethers.utils.parseUnits;
ethers.formatUnits = ethers.utils.formatUnits;
ethers.formatEther = ethers.utils.formatEther;
ethers.parseEther = ethers.utils.parseEther;
ethers.keccak256 = ethers.utils.keccak256;
ethers.solidityKeccak256 = ethers.utils.solidityKeccak256;
ethers.solidityPack = ethers.utils.solidityPack;
ethers.arrayify = ethers.utils.arrayify;
ethers.hexlify = ethers.utils.hexlify;
ethers.getAddress = ethers.utils.getAddress;
ethers.isAddress = ethers.utils.isAddress;
ethers.computeAddress = ethers.utils.computeAddress;
ethers.recoverAddress = ethers.utils.recoverAddress;
ethers.verifyMessage = ethers.utils.verifyMessage;
ethers.hashMessage = ethers.utils.hashMessage;
ethers.toUtf8Bytes = ethers.utils.toUtf8Bytes;
ethers.toUtf8String = ethers.utils.toUtf8String;
ethers.concat = ethers.utils.concat;
ethers.splitSignature = ethers.utils.splitSignature;
ethers.joinSignature = ethers.utils.joinSignature;
ethers.defaultAbiCoder = ethers.utils.defaultAbiCoder;
ethers.AbiCoder = ethers.utils.AbiCoder;
ethers.Interface = ethers.utils.Interface;
ethers.parseTransaction = ethers.utils.parseTransaction;
ethers.serializeTransaction = ethers.utils.serializeTransaction;

module.exports = ethers;
