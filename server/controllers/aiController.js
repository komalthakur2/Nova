import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import {v2 as cloudinary} from 'cloudinary';
import FormData from "form-data";
import fs from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const openai = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

export const generateArticle = async (req, res)=>{
    try{
        const {userId} = req.auth();
        const { prompt, length} = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;
        if(plan !== 'premium' && free_usage >=10){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium plan to continue.'})
    }
    const response = await openai.chat.completions.create({
    model: "gemini-2.5-flash",
    messages: [
        { role: "system", content: `You are an expert article writer. You MUST write a comprehensive article that is strictly around ${length} words in length. Do not stop early and ensure the length requirement is satisfied.` },
        {
            role: "user",
            content: prompt,
        },
    ],
    temperature: 0.7,
    max_tokens: length * 2,
});
const content = response.choices[0].message.content
await sql `INSERT INTO creations (user_id, prompt, content, type,publish) VALUES (${userId}, ${prompt}, ${content}, 'article',false)`;
if(plan !== 'premium'){
    await clerkClient.users.updateUserMetadata(userId,{
        privateMetadata: {free_usage: free_usage + 1}
})
    }
res.json({success: true, content})
}
    catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

export const generateBlogTitle = async (req, res)=>{
    try{
        const {userId} = req.auth();
        const { prompt} = req.body;
        const plan = req.plan;
        const free_usage = req.free_usage;
        if(plan !== 'premium' && free_usage >=10){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium plan to continue.'})
    }
    const response = await openai.chat.completions.create({
    model: "gemini-2.5-flash",
    messages: [
        { role: "system", content: "You are a creative blog title generator. Provide exactly 5 catchy, SEO-friendly blog titles formatted as a numbered list. Do not include any introductory or concluding text." },
        {
            role: "user",
            content: prompt,
        },
    ],
    temperature: 0.7,
    max_tokens: 1000,
});
const content = response.choices[0].message.content
await sql `INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'article')`;
if(plan !== 'premium'){
    await clerkClient.users.updateUserMetadata(userId,{
        privateMetadata: {free_usage: free_usage + 1}
})
    }
res.json({success: true, content})
}
    catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

export const generateImage= async (req, res)=>{
    try{
        const {userId} = req.auth();
        const { prompt,publish} = req.body;
        const plan = req.plan;
       
        if(plan !== 'premium' ){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium plan to continue.'})
    }
    const formData = new FormData()
formData.append('prompt', prompt)
const {data} = await axios.post("https://clipdrop-api.co/text-to-image/v1",formData,{
    headers:{
        'x-api-key': process.env.CLIPDROP_API_KEY,
        ...formData.getHeaders(),
    },
    responseType:"arraybuffer",
})
const base64Image = `data:image/png;base64,${Buffer.from(data, 'binary') . toString('base64')}`;
const{secure_url} = await cloudinary.uploader.upload(base64Image)

await sql `INSERT INTO creations (user_id, prompt, content, type,publish) VALUES (${userId}, ${prompt}, ${secure_url}, 'image',${publish ?? false})`;

res.json({success: true, content: secure_url})
}
    catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const image = req.file;
    const plan = req.plan;

    if (plan !== 'premium') {
      return res.json({
        success: false,
        message: 'Free usage limit reached. Please upgrade to premium plan to continue.',
      });
    }

    const { secure_url } = await cloudinary.uploader.upload(image.path, {
      transformation: [
        {
          effect: 'background_removal',
          background_removal: 'remove_the_background',
        },
      ],
    });

    await sql`
      INSERT INTO creations (user_id, prompt, content, type, publish)
      VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image', false)
    `;

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};

export const removeImageObject= async (req, res)=>{
    try{
        const {userId} = req.auth();
        const {object} = req.body;
        const image = req.file;
        const plan = req.plan;
       
        if(plan !== 'premium' ){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium plan to continue.'})
    }
   
const{public_id} = await cloudinary.uploader.upload(image.path)
const imageUrl = cloudinary.url(public_id, {
    transformation: [{effect: `gen_remove:${object}`}],
    resource_type: "image"
   })

await sql `INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${'Removed ${object} from image'}, ${imageUrl}, 'image')`;

res.json({success: true, content: imageUrl})
}
    catch (error) {
        console.log(error.message);
        res.json({success: false, message: error.message})
    }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const resumeReview = async (req, res) => {
  try {
    console.log("Resume controller reached");
    const { userId } = req.auth();
    const resume = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "Free usage limit reached. Please upgrade to premium plan to continue.",
      });
    }

    console.log("Uploaded file:", req.file);
    if (!resume) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return res.json({
        success: false,
        message: "File size exceeds the 5MB limit.",
      });
    }

    const dataBuffer = fs.readFileSync(resume.path);
    const pdfData = await pdfParse(dataBuffer);
    console.log("PDF parsed successfully");

    const cleanedText = pdfData.text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);

    const prompt = `Review the following resume and provide constructive feedback on its strengths, weaknesses, and areas for improvement. Resume Content:\n\n${cleanedText}`;

    console.log("Sending request to Gemini");
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const review = response.text();
    console.log("Gemini response received");

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Review the uploaded resume', ${review}, 'resume-review')
    `;

    res.json({ success: true, content: review });
  } catch (error) {
    console.error("Resume Review Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
