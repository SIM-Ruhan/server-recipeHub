const express = require('express');
const cors = require("cors");
const app = express()
const port = 8000
require("dotenv").config()
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion } = require('mongodb');
app.get('/', (req, res) => {
  res.send('Hello World!')
})

//Mongodb Start
const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
const database = client.db("recipe");
const recipeCollection = database.collection("recipes");



app.get("/api/recipes", async (req,res)=> {
const query = {};

if(req.query.companyId){
    query.companyId = req.query.companyId;
}
if(req.query.status){
    query.status = req.query.status;
}
const cursor = recipeCollection.find(query);
const result = await cursor.toArray();
res.send(result);
})

app.post("/api/recipes", async (req,res)=> {
    const recipe = req.body;
    const result = await recipeCollection.insertOne(recipe);
    res.send(result);
})



    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    
  }
}
run().catch(console.dir);

//Mongodb end

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})