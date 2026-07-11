// const express = require('express');
// const cors = require("cors");
// const app = express()
// const port = 8000
// require("dotenv").config()
// app.use(cors());
// app.use(express.json());

// const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// app.get('/', (req, res) => {
//   res.send('Hello World!')
// })

// //Mongodb Start
// const uri = process.env.MONGODB_URI;

// // Create a MongoClient with a MongoClientOptions object to set the Stable API version
// const client = new MongoClient(uri, {
//   serverApi: {
//     version: ServerApiVersion.v1,
//     strict: true,
//     deprecationErrors: true,
//   }
// });

// async function run() {
//   try {
//     // Connect the client to the server	(optional starting in v4.7)
//     await client.connect();
//     // Send a ping to confirm a successful connection
// const database = client.db("recipe");
// const recipeCollection = database.collection("recipes");




// app.get("/api/recipes", async (req,res)=> {
// const query = {};

// if(req.query.companyId){
//     query.companyId = req.query.companyId;
// }
// if(req.query.status){
//     query.status = req.query.status;
// }
// const cursor = recipeCollection.find(query);
// const result = await cursor.toArray();
// res.send(result);
// })

// app.get("/api/recipes/:id", async (req,res) => {
//     const id = req.params.id;
//     const query = {
//         _id: new ObjectId(id)
//     }
//     const result = await recipeCollection.findOne(query);
//     res.send(result);
// })

// app.post("/api/recipes", async (req,res)=> {
//     const recipe = req.body;
//     const result = await recipeCollection.insertOne(recipe);
//     res.send(result);
// })



//     await client.db("admin").command({ ping: 1 });
//     console.log("Pinged your deployment. You successfully connected to MongoDB!");
//   } finally {
//     // Ensures that the client will close when you finish/error
    
//   }
// }
// run().catch(console.dir);

// //Mongodb end

// app.listen(port, () => {
//   console.log(`Example app listening on port ${port}`)
// })

//-------------------------------------------------------------------------------------------

const express = require('express');
const cors = require("cors");
const app = express();
const port = 8000;
require("dotenv").config();

app.use(cors({
  origin: [
    'https://recipe-hub-client-orcin.vercel.app',
    'http://localhost:3000'
  ],
  credentials: true
}));
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// ✅ Keys must match what gets stored in user.plan after payment
const PLAN_LIMITS = {
  free:           2,
  seller_starter: 10,
  seller_pro:     50,
  seller_master:  Infinity,
};

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const database          = client.db("recipe");
    const recipeCollection  = database.collection("recipes");
    const userCollection    = database.collection("user");
    const subscriptionCollection = database.collection("subscriptions");
 const reportCollection = database.collection("reports");
    const favoriteCollection = database.collection("favorites");
    const likesCollection = database.collection("likes");
    const purchaseCollection = database.collection("purchases");


    // GET all recipes (with optional filters)
    app.get("/api/recipes", async (req, res) => {
      const query = {};
      if (req.query.companyId) query.companyId = req.query.companyId;
      if (req.query.status)    query.status    = req.query.status;
      if (req.query.authorId)  query.authorId  = req.query.authorId;
      const cursor = recipeCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    //start 
// GET - aggregated stats for a seller (favorites + engagement across all their recipes)
app.get("/api/recipes/stats/:authorId", async (req, res) => {
  try {
    const { authorId } = req.params;

    // Pull all of this seller's recipes (not just active) to sum likes
    const recipes = await recipeCollection
      .find({ authorId })
      .project({ _id: 1, likesCount: 1 })
      .toArray();

    const recipeIds = recipes.map((r) => r._id.toString());
    const totalLikes = recipes.reduce((sum, r) => sum + (r.likesCount || 0), 0);

    const totalFavorites = recipeIds.length
      ? await favoriteCollection.countDocuments({ recipeId: { $in: recipeIds } })
      : 0;

    const totalEngagement = totalLikes + totalFavorites;

    res.send({
      success: true,
      totalRecipes: recipes.length,
      totalLikes,
      totalFavorites,
      totalEngagement,
    });
  } catch (error) {
    console.error("Error fetching seller stats:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
    //end

    //get the users
    // GET all users
app.get("/api/users", async (req, res) => {
  try {
    const users = await userCollection.find({}).toArray();

    res.send(users);
  } catch (err) {
    console.error(err);

    res.status(500).send({
      success: false,
      message: err.message,
    });
  }
});

//Start here
// Purchase a recipe
app.post("/api/purchases", async (req, res) => {
  try {
    const {
      recipeId,
      userId,
      price
    } = req.body;

    if (!recipeId || !userId) {
      return res.status(400).send({
        success: false,
        message: "Missing recipeId or userId"
      });
    }

    // Prevent duplicate purchases
    const alreadyPurchased = await purchaseCollection.findOne({
      recipeId,
      userId
    });

    if (alreadyPurchased) {
      return res.send({
        success: true,
        alreadyPurchased: true
      });
    }

    const recipe = await recipeCollection.findOne({
      _id: new ObjectId(recipeId)
    });

    if (!recipe) {
      return res.status(404).send({
        success: false,
        message: "Recipe not found"
      });
    }

    const purchase = {
      recipeId,
      userId,

      recipeName: recipe.recipeName,
      recipeImage: recipe.image,
      authorName: recipe.authorName,
      price: recipe.price || price,

      purchasedAt: new Date()
    };

    await purchaseCollection.insertOne(purchase);

    res.send({
      success: true
    });

  } catch (err) {
    console.log(err);

    res.status(500).send({
      success: false
    });
  }
});

app.get("/api/users/:userId/purchases", async (req, res) => {

  try {

    const { userId } = req.params;

    const purchases = await purchaseCollection
      .find({ userId })
      .sort({ purchasedAt: -1 })
      .toArray();

    res.send({
      success: true,
      purchases
    });

  } catch (err) {

    res.status(500).send({
      success: false
    });

  }

});
//end here

//block/unblock users

app.patch("/api/users/:id/toggle-block", async (req, res) => {
  try {
    const userId = req.params.id;
    const { isBlocked } = req.body; // Expecting boolean from client

    if (!ObjectId.isValid(userId)) {
      return res.status(400).send({ success: false, message: "Invalid User ID format" });
    }

    const result = await database.collection("user").updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          isBlocked: isBlocked,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "User not found" });
    }

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error toggling block state:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// Feature status
// PATCH - Toggle recipe feature status
    app.patch("/api/recipes/:id/feature", async (req, res) => {
      try {
        const id = req.params.id;
        const { isFeatured } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        const result = await recipeCollection.updateOne(
          { _id: new ObjectId(id) },
          { 
            $set: { 
              isFeatured: isFeatured,
              updatedAt: new Date()
            } 
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        console.error("Error toggling feature state:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
      }
    });
    // PATCH - Update a recipe (edit)
app.patch("/api/recipes/:id", async (req, res) => {
  try {
    const id = req.params.id;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }

    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id; // never let client overwrite _id

    const result = await recipeCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({ success: false, message: "Recipe not found" });
    }

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating recipe:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

    // DELETE - Delete a recipe permanently
    app.delete("/api/recipes/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
        }

        const result = await recipeCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).send({ success: false, message: "Recipe not found" });
        }

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        console.error("Error deleting recipe:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
      }
    });


    // 1. PATCH - Like/Unlike Recipe (now tracks per-user state)
app.patch("/api/recipes/:id/like", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId, isLiked } = req.body;

    if (!ObjectId.isValid(recipeId)) {
      return res.status(400).send({ success: false, message: "Invalid Recipe ID" });
    }

    if (isLiked) {
      // Add like record (avoid duplicates)
      await likesCollection.updateOne(
        { userId, recipeId },
        { $setOnInsert: { userId, recipeId, createdAt: new Date() } },
        { upsert: true }
      );
    } else {
      await likesCollection.deleteOne({ userId, recipeId });
    }

    const result = await recipeCollection.updateOne(
      { _id: new ObjectId(recipeId) },
      { $inc: { likesCount: isLiked ? 1 : -1 } }
    );

    res.send({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error updating likes:", error);
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

//start here
app.patch("/api/recipes/:id/favorite", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId, isSaved } = req.body;

    if (!ObjectId.isValid(recipeId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Recipe ID",
      });
    }

    if (isSaved) {
      await favoriteCollection.updateOne(
        { userId, recipeId },
        {
          $setOnInsert: {
            userId,
            recipeId,
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
    } else {
      await favoriteCollection.deleteOne({
        userId,
        recipeId,
      });
    }

    res.send({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      message: "Internal Server Error",
    });
  }
});
//end here

// GET - check like/favorite status for a user on a recipe (for initial page load)
app.get("/api/recipes/:id/status", async (req, res) => {
  try {
    const recipeId = req.params.id;
    const { userId } = req.query;

    const [liked, favorited] = await Promise.all([
      likesCollection.findOne({ userId, recipeId }),
      favoriteCollection.findOne({ userId, recipeId }),
    ]);

    res.send({ isLiked: !!liked, isSaved: !!favorited });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// GET - user's liked recipes (for dashboard)
app.get("/api/users/:userId/liked-recipes", async (req, res) => {
  try {
    const { userId } = req.params;
    const likes = await likesCollection.find({ userId }).toArray();
    const recipeIds = likes.map(l => new ObjectId(l.recipeId));
    const recipes = await recipeCollection.find({ _id: { $in: recipeIds } }).toArray();
    res.send({ success: true, recipes });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// GET - user's favorite recipes (for dashboard)
app.get("/api/users/:userId/favorites", async (req, res) => {
  try {
    const { userId } = req.params;
    const favs = await favoriteCollection.find({ userId }).toArray();
    const recipeIds = favs.map(f => new ObjectId(f.recipeId));
    const recipes = await recipeCollection.find({ _id: { $in: recipeIds } }).toArray();
    res.send({ success: true, recipes });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});


app.get("/api/users/:userId/favorites", async (req, res) => {
    try {
        const { userId } = req.params;

        // 1. Find all favorite records for this user
        const favoriteRecords = await favoriteCollection
            .find({ userId })
            .sort({ createdAt: -1 })
            .toArray();

        if (favoriteRecords.length === 0) {
            return res.send({ success: true, recipes: [] });
        }

        // 2. Collect the recipe ObjectIds
        const recipeObjectIds = favoriteRecords
            .map(f => {
                try { return new ObjectId(f.recipeId); }
                catch { return null; }
            })
            .filter(Boolean);

        // 3. Fetch the full recipe documents in one query
        const recipes = await recipeCollection
            .find({ _id: { $in: recipeObjectIds } })
            .toArray();

        // 4. Preserve the "most-recently-saved first" ordering
        const recipeMap = Object.fromEntries(recipes.map(r => [r._id.toString(), r]));
        const orderedRecipes = favoriteRecords
            .map(f => recipeMap[f.recipeId])
            .filter(Boolean);

        res.send({ success: true, recipes: orderedRecipes });
    } catch (error) {
        console.error("Error fetching favorites:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
    }
});



app.delete("/api/users/:userId/favorites/:recipeId", async (req, res) => {
    try {
        const { userId, recipeId } = req.params;
        const result = await favoriteCollection.deleteOne({ userId, recipeId });
        res.send({ success: true, deletedCount: result.deletedCount });
    } catch (error) {
        console.error("Error deleting favorite:", error);
        res.status(500).send({ success: false, message: "Internal Server Error" });
    }
});
//end here
// GET - admin: all reports
app.get("/api/admin/reports", async (req, res) => {
  try {
    const reports = await reportCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.send({ success: true, reports });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});

// PATCH - admin: update report status
app.patch("/api/admin/reports/:id", async (req, res) => {
  try {
    const { status } = req.body; // "resolved" | "dismissed"
    await reportCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status } }
    );
    res.send({ success: true });
  } catch (error) {
    res.status(500).send({ success: false, message: "Internal Server Error" });
  }
});
   
//end here
    // GET single recipe by ID
    app.get("/api/recipes/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await recipeCollection.findOne(query);
      res.send(result);
    });

    // GET recipe count by authorId
    // ⚠️ Must stay ABOVE /api/recipes/:id
    app.get("/api/recipes/count/:authorId", async (req, res) => {
      const { authorId } = req.params;
      const count = await recipeCollection.countDocuments({ authorId });
      res.send({ count });
    });

    // POST subscription — save sub + update user plan
    app.post("/api/subscriptions", async (req, res) => {
      const data = req.body;
      // data.planId will be e.g. "seller_starter", "seller_pro", "seller_master"

      // 1. Save subscription record
      const subsInfo = {
        ...data,
        createdAt: new Date(),
      };
      await subscriptionCollection.insertOne(subsInfo);

      // 2. ✅ Update user.plan to e.g. "seller_starter" — matches PLAN_LIMITS keys
      const userFilter = { email: data.email };
      const userUpdate = {
        $set: {
          plan:      data.planId,       // "seller_starter" / "seller_pro" / "seller_master"
          updatedAt: new Date(),
        },
      };
      const updateResult = await userCollection.updateOne(userFilter, userUpdate);

      // ✅ Single res.send() — no double-send crash
      res.send({
        success:  true,
        modified: updateResult.modifiedCount,
      });
    });

    // POST create recipe — with plan limit enforcement
    app.post("/api/recipes", async (req, res) => {
      const { userPlan, ...recipeData } = req.body;
      const authorId = recipeData.authorId;

      // Reject anonymous users
      if (!authorId || authorId === "anonymous") {
        return res.status(401).send({
          success: false,
          message: "You must be logged in to create a recipe.",
        });
      }



      // ✅ Fetch the user's LIVE plan directly from DB — never trust the client
      const userDoc = await userCollection.findOne({ _id: new ObjectId(authorId) });
      const plan    = userDoc?.plan || "free";   // e.g. "seller_starter", "free"

      // ✅ Lookup limit — PLAN_LIMITS keys now match DB values exactly
      const limit = Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan)
        ? PLAN_LIMITS[plan]
        : PLAN_LIMITS["free"];

      // Count existing recipes for this user
      const existingCount = await recipeCollection.countDocuments({ authorId });

      console.log(`User: ${authorId} | Plan: ${plan} | Limit: ${limit} | Count: ${existingCount}`);

      if (existingCount >= limit) {
        return res.status(403).send({
          success: false,
          message: "LIMIT_REACHED",
          details: `Your ${plan} plan allows a maximum of ${limit === Infinity ? "unlimited" : limit} recipes. Please upgrade.`,
        });
      }

      // Insert recipe
      const result = await recipeCollection.insertOne({
        ...recipeData,
        createdAt: new Date(),
      });

      res.send({ success: true, insertedId: result.insertedId });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});